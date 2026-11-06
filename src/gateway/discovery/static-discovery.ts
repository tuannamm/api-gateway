import { readFileSync } from 'node:fs';
import { ConfigError } from '../errors';
import type { Instance, ServiceDiscovery } from './types';

/**
 * Discovery tĩnh: đọc danh sách instance từ file JSON lúc khởi động.
 * Dùng để chạy gateway khi chưa có Service Registry thật. Dữ liệu có cùng hình dạng
 * với dữ liệu service sẽ gửi lên registry khi đăng ký:
 *
 * {
 *   "instances": [
 *     { "project": "example", "service": "echo", "id": "echo-1",
 *       "host": "127.0.0.1", "port": 4001,
 *       "patterns": ["user.getById", "user.list"] }
 *   ]
 * }
 */
export interface StaticInstanceEntry extends Instance {
  project: string;
  patterns: string[];
}

export class StaticDiscovery implements ServiceDiscovery {
  /** project → pattern → instances. Dựng một lần, data plane chỉ tra cứu. */
  private constructor(private readonly table: Map<string, Map<string, Instance[]>>) {}

  static fromFile(filePath: string): StaticDiscovery {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new ConfigError(`Cannot read discovery file ${filePath}: ${(error as Error).message}`);
    }
    return StaticDiscovery.fromEntries(raw, filePath);
  }

  /** Validate toàn bộ dữ liệu, gom mọi lỗi rồi báo một lần (giống SpecLoader). */
  static fromEntries(raw: unknown, source = '<in-memory>'): StaticDiscovery {
    const entries = (raw as { instances?: unknown })?.instances;
    if (!Array.isArray(entries)) {
      throw new ConfigError(`Discovery file ${source}: expected { "instances": [...] }.`);
    }

    const issues: string[] = [];
    const table = new Map<string, Map<string, Instance[]>>();
    const owners = new Map<string, string>(); // "project pattern" → service đang giữ pattern
    const ids = new Set<string>();

    entries.forEach((entry: Partial<StaticInstanceEntry>, index) => {
      const where = `instances[${index}]`;
      const problems = validateEntry(entry);
      if (problems.length) {
        issues.push(...problems.map((p) => `${where}: ${p}`));
        return;
      }
      const e = entry as StaticInstanceEntry;

      if (ids.has(e.id)) {
        issues.push(`${where}: duplicate instance id "${e.id}".`);
        return;
      }
      ids.add(e.id);

      const instance: Instance = { id: e.id, service: e.service, host: e.host, port: e.port };
      const byPattern = table.get(e.project) ?? new Map<string, Instance[]>();
      table.set(e.project, byPattern);

      for (const pattern of e.patterns) {
        // Một pattern chỉ thuộc MỘT service trong một project, nếu không gateway không biết gửi cho ai.
        const ownerKey = `${e.project} ${pattern}`;
        const owner = owners.get(ownerKey);
        if (owner && owner !== e.service) {
          issues.push(
            `${where}: pattern "${pattern}" in project "${e.project}" is already handled by service "${owner}".`,
          );
          continue;
        }
        owners.set(ownerKey, e.service);
        byPattern.set(pattern, [...(byPattern.get(pattern) ?? []), instance]);
      }
    });

    if (issues.length) {
      throw new ConfigError(
        `Invalid discovery file ${source} (${issues.length} issue(s)):\n` +
          issues.map((i) => `  - ${i}`).join('\n'),
      );
    }
    return new StaticDiscovery(table);
  }

  async resolve(project: string, pattern: string): Promise<Instance[]> {
    // Trả bản copy để nơi gọi không sửa được bảng bên trong.
    return [...(this.table.get(project)?.get(pattern) ?? [])];
  }

  /** Các pattern đang có instance trong project (để log lúc khởi động). */
  patterns(project: string): string[] {
    return [...(this.table.get(project)?.keys() ?? [])].sort();
  }
}

function validateEntry(entry: Partial<StaticInstanceEntry>): string[] {
  if (typeof entry !== 'object' || entry === null) return ['must be an object.'];
  const problems: string[] = [];
  for (const field of ['project', 'service', 'id', 'host'] as const) {
    if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
      problems.push(`"${field}" must be a non-empty string.`);
    }
  }
  if (!Number.isInteger(entry.port) || entry.port! < 1 || entry.port! > 65535) {
    problems.push(`"port" must be an integer between 1 and 65535.`);
  }
  if (
    !Array.isArray(entry.patterns) ||
    entry.patterns.length === 0 ||
    entry.patterns.some((p) => typeof p !== 'string' || p === '')
  ) {
    problems.push(`"patterns" must be a non-empty array of non-empty strings.`);
  }
  return problems;
}
