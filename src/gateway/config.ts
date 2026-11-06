import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ConfigError } from './errors';

/**
 * Cấu hình theo project: một instance gateway chỉ phục vụ MỘT project,
 * chọn bằng GATEWAY_PROJECT. Spec nằm ở <GATEWAY_SPECS_DIR>/<project>/<GATEWAY_SPEC_FILE>.
 */
export interface GatewayConfig {
  project: string;
  specsDir: string;
  /** Đường dẫn tuyệt đối tới file spec đã được kiểm tra là tồn tại. */
  specPath: string;
  /** Đường dẫn tuyệt đối tới file JSON của StaticDiscovery. */
  discoveryFile: string;
  /** Thời gian tối đa chờ service trả lời (ms). Quá thì 504. */
  rpcTimeoutMs: number;
  /** Kích thước body tối đa (byte). Quá thì 413. */
  bodyLimit: number;
  /** Số instance tối đa được thử cho một request khi failover (1 = tắt failover). */
  failoverMaxAttempts: number;
  port: number;
}

const DEFAULT_SPECS_DIR = './specs';
const DEFAULT_SPEC_FILE = 'openapi.yml';
const DEFAULT_RPC_TIMEOUT_MS = 10_000;
const DEFAULT_BODY_LIMIT = 1024 * 1024; // 1 MB
const DEFAULT_FAILOVER_MAX_ATTEMPTS = 3;
const DEFAULT_PORT = 3000;

/** Chỉ chữ thường, số, `_`, `-`. Không có `/`, `.` nên không thể viết `../`. */
const PROJECT_NAME = /^[a-z0-9_-]+$/;

/**
 * Đọc và kiểm tra cấu hình. Nhận `env` và `cwd` làm tham số (thay vì đọc thẳng
 * process.env) để test truyền giá trị giả vào được.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): GatewayConfig {
  const specsDir = path.resolve(cwd, env.GATEWAY_SPECS_DIR || DEFAULT_SPECS_DIR);
  const specFile = env.GATEWAY_SPEC_FILE || DEFAULT_SPEC_FILE;
  const project = env.GATEWAY_PROJECT?.trim();

  if (!project) {
    throw new ConfigError(
      `GATEWAY_PROJECT is required. ${describeAvailableProjects(specsDir)}`,
    );
  }

  // Lớp chặn 1: kiểm tra định dạng tên. Chặn ngay `../../etc`.
  if (!PROJECT_NAME.test(project)) {
    throw new ConfigError(
      `GATEWAY_PROJECT "${project}" is invalid: only lowercase letters, digits, "_" and "-" are allowed.`,
    );
  }

  // Tên file cũng lấy từ env nên phải chặn tương tự: chỉ là tên file, không chứa thư mục.
  if (path.basename(specFile) !== specFile || specFile === '..' || specFile === '.') {
    throw new ConfigError(
      `GATEWAY_SPEC_FILE "${specFile}" must be a plain file name, not a path.`,
    );
  }

  const specPath = path.resolve(specsDir, project, specFile);

  // Lớp chặn 2 (defense in depth): sau khi resolve, đường dẫn PHẢI nằm trong specsDir.
  // Nếu sau này ai đó nới lỏng regex ở trên, lớp này vẫn bảo vệ.
  if (!isInside(specsDir, specPath)) {
    throw new ConfigError(`Resolved spec path escapes ${specsDir}: ${specPath}`);
  }

  if (!existsSync(specPath) || !statSync(specPath).isFile()) {
    throw new ConfigError(
      `Spec file not found for project "${project}": ${specPath}. ${describeAvailableProjects(specsDir)}`,
    );
  }

  const discoveryEnv = env.GATEWAY_DISCOVERY_FILE?.trim();
  if (!discoveryEnv) {
    throw new ConfigError('GATEWAY_DISCOVERY_FILE is required (path to the static discovery JSON).');
  }
  const discoveryFile = path.resolve(cwd, discoveryEnv);
  if (!existsSync(discoveryFile) || !statSync(discoveryFile).isFile()) {
    throw new ConfigError(`Discovery file not found: ${discoveryFile}`);
  }

  return {
    project,
    specsDir,
    specPath,
    discoveryFile,
    rpcTimeoutMs: positiveInt(env, 'GATEWAY_RPC_TIMEOUT_MS', DEFAULT_RPC_TIMEOUT_MS),
    bodyLimit: positiveInt(env, 'GATEWAY_BODY_LIMIT', DEFAULT_BODY_LIMIT),
    failoverMaxAttempts: positiveInt(env, 'GATEWAY_FAILOVER_MAX_ATTEMPTS', DEFAULT_FAILOVER_MAX_ATTEMPTS, 10),
    port: positiveInt(env, 'PORT', DEFAULT_PORT, 65_535),
  };
}

/** Đọc số nguyên dương từ env; sai định dạng thì báo lỗi thay vì âm thầm dùng NaN. */
function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || value < 1 || value > max) {
    throw new ConfigError(`${name} must be an integer between 1 and ${max}, got "${raw}".`);
  }
  return value;
}

/** Liệt kê các project hiện có: mọi thư mục con có tên hợp lệ trong specsDir. */
export function listProjects(specsDir: string): string[] {
  if (!existsSync(specsDir)) return [];
  return readdirSync(specsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && PROJECT_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function describeAvailableProjects(specsDir: string): string {
  const projects = listProjects(specsDir);
  return projects.length
    ? `Available projects in ${specsDir}: ${projects.join(', ')}.`
    : `No projects found in ${specsDir}.`;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
