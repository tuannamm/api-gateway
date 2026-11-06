import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI, OpenAPIV3 } from 'openapi-types';
import { SpecValidationError } from './errors';
import { routeShape } from './route-table';
import { HTTP_METHODS, type RouteDefinition } from './types';

/**
 * Control plane: biến file OpenAPI thành danh sách RouteDefinition.
 *
 * Luật riêng của gateway về operationId:
 *   - BẮT BUỘC có, là string tự do không rỗng (VD "getUserById", "user.getById").
 *   - KHÔNG được trùng: nó là @MessagePattern, hai route cùng pattern thì không phân biệt được.
 *   - Không có khoảng trắng ở đầu/cuối: pattern phải khớp CHÍNH XÁC với @MessagePattern của service,
 *     một dấu cách thừa là lỗi khó tìm.
 */

export interface LoadedSpec {
  title: string;
  version: string;
  routes: RouteDefinition[];
}

/**
 * Đọc, validate và biên dịch spec. Chạy MỘT LẦN lúc khởi động (và khi hot reload).
 * Ném SpecValidationError chứa mọi lỗi tìm được.
 */
export async function loadSpec(specPath: string): Promise<LoadedSpec> {
  let api: OpenAPI.Document;
  try {
    // validate() = parse YAML/JSON + kiểm tra theo JSON Schema của OpenAPI + resolve $ref.
    api = await SwaggerParser.validate(specPath);
  } catch (error) {
    throw new SpecValidationError(specPath, [(error as Error).message]);
  }

  return {
    title: api.info.title,
    version: api.info.version,
    routes: extractRoutes(api, specPath),
  };
}

/**
 * Duyệt paths × methods, áp các luật riêng của gateway (ngoài luật của OpenAPI).
 * Hàm thuần (không I/O) nên test trực tiếp bằng object được.
 */
export function extractRoutes(
  api: OpenAPI.Document,
  specPath = '<in-memory>',
): RouteDefinition[] {
  if (!('openapi' in api) || !String(api.openapi).startsWith('3.')) {
    throw new SpecValidationError(specPath, [
      'Only OpenAPI 3.x is supported (found Swagger 2.0 or unknown version).',
    ]);
  }

  const issues: string[] = [];
  const routes: RouteDefinition[] = [];
  const operationIds = new Map<string, string>(); // operationId → nơi khai báo đầu tiên
  const shapes = new Map<string, string>(); // "get /users/{}" → path gốc

  const paths = (api as OpenAPIV3.Document).paths ?? {};
  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as OpenAPIV3.OperationObject | undefined;
      if (!operation) continue;

      const where = `${method.toUpperCase()} ${pathTemplate}`;
      const operationId = operation.operationId;

      if (operationId === undefined) {
        issues.push(`${where}: missing operationId (required by the gateway).`);
        continue;
      }

      if (operationId.trim() === '') {
        issues.push(`${where}: operationId must not be empty.`);
        continue;
      }

      if (operationId !== operationId.trim()) {
        issues.push(`${where}: operationId "${operationId}" has leading/trailing whitespace.`);
        continue;
      }

      const firstUse = operationIds.get(operationId);
      if (firstUse) {
        issues.push(`${where}: duplicate operationId "${operationId}" (already used by ${firstUse}).`);
        continue;
      }
      operationIds.set(operationId, where);

      // `/users/{id}` và `/users/{userId}` cùng method thì không thể phân biệt khi match.
      const shapeKey = `${method} ${routeShape(pathTemplate)}`;
      const sameShape = shapes.get(shapeKey);
      if (sameShape) {
        issues.push(`${where}: ambiguous with ${method.toUpperCase()} ${sameShape} (same path shape).`);
        continue;
      }
      shapes.set(shapeKey, pathTemplate);

      routes.push({
        method,
        path: pathTemplate,
        operationId,
        successStatus: pickSuccessStatus(operation.responses),
      });
    }
  }

  if (issues.length > 0) throw new SpecValidationError(specPath, issues);
  return routes;
}

/**
 * Message RPC không có HTTP status, nên gateway lấy status thành công từ spec:
 * mã 2xx nhỏ nhất được khai báo (VD POST khai báo '201' → trả 201). Mặc định 200.
 */
export function pickSuccessStatus(responses: OpenAPIV3.ResponsesObject | undefined): number {
  const codes = Object.keys(responses ?? {})
    .map((key) => (key.toUpperCase() === '2XX' ? 200 : Number(key)))
    .filter((code) => Number.isInteger(code) && code >= 200 && code < 300)
    .sort((a, b) => a - b);
  return codes[0] ?? 200;
}
