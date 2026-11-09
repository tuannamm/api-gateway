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
  for (const [name, scheme] of Object.entries(api.components?.securitySchemes ?? {})) {
    if (!('type' in scheme) || scheme.type !== 'http' || scheme.scheme.toLowerCase() !== 'bearer') {
      issues.push(`Unsupported security scheme: ${name}`);
    }
  }
  const validateSecurity = (security: OpenAPIV3.SecurityRequirementObject[] | undefined) => {
    if (!security) return;
    for (const requirement of security) {
      const names = Object.keys(requirement);
      if (names.length !== 1 || names.some(name => !api.components?.securitySchemes?.[name] || requirement[name].length !== 0)) {
        issues.push('Only bearer security requirements with empty scopes are supported');
      }
    }
  };
  validateSecurity(api.security);

  const routes: RouteDefinition[] = [];
  const operationIds = new Map<string, string>(); // operationId → nơi khai báo đầu tiên
  const shapes = new Map<string, string>(); // "get /users/{}" → path gốc

  const paths = (api as OpenAPIV3.Document).paths ?? {};
  for (const [pathTemplate, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as OpenAPIV3.OperationObject | undefined;
      if (!operation) continue;

      validateSecurity(operation.security);
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

      const requiresAuth = !(operation.security?.length === 0 || (operation.security === undefined && api.security?.length === 0));
      const permissions = readPermissions(operation, requiresAuth, where, issues);
      if (permissions === 'invalid') continue;

      routes.push({
        method,
        path: pathTemplate,
        operationId,
        successStatus: pickSuccessStatus(operation.responses),
        requiresAuth,
        ...(permissions && { permissions }),
      });
    }
  }

  if (issues.length > 0) throw new SpecValidationError(specPath, issues);
  return routes;
}

const PERMISSION_KEY = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
export const PERMISSIONS_EXTENSION = 'x-required-permissions';

/**
 * Đọc `x-required-permissions`. Từ chối mặc định:
 *   - route cần đăng nhập mà thiếu khai báo → lỗi (dùng `[]` nếu chỉ cần đăng nhập);
 *   - route công khai mà có khai báo → lỗi (vô nghĩa, dễ nhầm là đã được bảo vệ);
 *   - phải là mảng key `resource:action`, không trùng.
 * Trả `undefined` cho route công khai, 'invalid' khi đã ghi lỗi vào `issues`.
 */
function readPermissions(
  operation: OpenAPIV3.OperationObject,
  requiresAuth: boolean,
  where: string,
  issues: string[],
): string[] | undefined | 'invalid' {
  const raw = (operation as Record<string, unknown>)[PERMISSIONS_EXTENSION];
  if (!requiresAuth) {
    if (raw === undefined) return undefined;
    issues.push(`${where}: public route (security: []) must not declare ${PERMISSIONS_EXTENSION}.`);
    return 'invalid';
  }
  if (raw === undefined) {
    issues.push(`${where}: missing ${PERMISSIONS_EXTENSION} (use [] when any authenticated user may call it).`);
    return 'invalid';
  }
  if (!Array.isArray(raw) || raw.some((key) => typeof key !== 'string' || !PERMISSION_KEY.test(key))) {
    issues.push(`${where}: ${PERMISSIONS_EXTENSION} must be an array of "resource:action" keys.`);
    return 'invalid';
  }
  if (new Set(raw).size !== raw.length) {
    issues.push(`${where}: ${PERMISSIONS_EXTENSION} contains duplicate keys.`);
    return 'invalid';
  }
  return [...raw] as string[];
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
