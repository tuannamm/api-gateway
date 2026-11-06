import type { HttpMethod, MatchResult, RouteDefinition } from './types';

/**
 * Bảng route dạng segment trie (cây theo từng đoạn của path).
 *
 *   /users            root ─ "users"
 *   /users/me                    ├─ "me"        (nhánh tĩnh)
 *   /users/{id}                  └─ {param}     (nhánh tham số)
 *   /users/{id}/orders                 └─ "orders"
 *
 * - Match tốn O(số segment của path), không phụ thuộc tổng số route.
 * - Nhánh tĩnh được thử TRƯỚC nhánh tham số, có backtrack nếu nhánh tĩnh không dẫn tới route phù hợp.
 * - Tên tham số lưu ở LÁ (theo từng route), không lưu ở node, nên
 *   `/users/{id}` và `/users/{userId}/orders` cùng tồn tại được.
 */

interface Handler {
  route: RouteDefinition;
  /** Tên các tham số theo đúng thứ tự xuất hiện trong path template. */
  paramNames: string[];
}

interface TrieNode {
  staticChildren: Map<string, TrieNode>;
  paramChild?: TrieNode;
  /** Chỉ có ở node kết thúc một path. Map method → handler, dùng để phân biệt 404 và 405. */
  handlers?: Map<HttpMethod, Handler>;
}

const PARAM_SEGMENT = /^\{([^{}]+)\}$/;

export class RouteTable {
  private readonly root: TrieNode = createNode();
  private count = 0;

  static from(routes: readonly RouteDefinition[]): RouteTable {
    const table = new RouteTable();
    for (const route of routes) table.insert(route);
    return table;
  }

  get size(): number {
    return this.count;
  }

  insert(route: RouteDefinition): void {
    let node = this.root;
    const paramNames: string[] = [];

    for (const segment of splitPath(route.path)) {
      const param = PARAM_SEGMENT.exec(segment);
      if (param) {
        paramNames.push(param[1]);
        node.paramChild ??= createNode();
        node = node.paramChild;
      } else {
        let next = node.staticChildren.get(segment);
        if (!next) {
          next = createNode();
          node.staticChildren.set(segment, next);
        }
        node = next;
      }
    }

    node.handlers ??= new Map();
    const existing = node.handlers.get(route.method);
    if (existing) {
      // SpecLoader đã chặn trường hợp này; đây là lưới an toàn nếu RouteTable được dùng trực tiếp.
      throw new Error(
        `Route conflict: ${route.method.toUpperCase()} ${route.path} (${route.operationId}) ` +
          `has the same shape as ${existing.route.path} (${existing.route.operationId})`,
      );
    }
    node.handlers.set(route.method, { route, paramNames });
    this.count++;
  }

  /**
   * Tra cứu một request. `rawPath` có thể kèm query string (`/users/42?x=1`); phần đó bị bỏ qua.
   * Hàm này chạy ở data plane: chỉ đọc bộ nhớ, không I/O.
   */
  match(method: string, rawPath: string): MatchResult {
    const wanted = method.toLowerCase() as HttpMethod;
    const segments = splitPath(stripQueryAndFragment(rawPath));
    const allowed = new Set<HttpMethod>();

    for (const candidate of this.walk(this.root, segments, 0, [])) {
      const handler = candidate.node.handlers!.get(wanted);
      if (!handler) {
        // Path khớp nhưng method không có ở ứng viên này: ghi nhận, thử ứng viên tiếp theo.
        for (const m of candidate.node.handlers!.keys()) allowed.add(m);
        continue;
      }

      const params: Record<string, string> = {};
      for (let i = 0; i < handler.paramNames.length; i++) {
        // Decode SAU khi match: `%2F` trong tham số không được biến thành `/` và làm lệch path.
        const decoded = safeDecode(candidate.values[i]);
        if (decoded === undefined) return { kind: 'invalid_path' };
        params[handler.paramNames[i]] = decoded;
      }
      return { kind: 'found', route: handler.route, params };
    }

    return allowed.size > 0
      ? { kind: 'method_not_allowed', allowed: [...allowed].sort() }
      : { kind: 'not_found' };
  }

  /**
   * Duyệt cây theo chiều sâu, yield mọi node kết thúc khớp với path,
   * theo thứ tự ưu tiên: nhánh tĩnh trước, nhánh tham số sau.
   * Dùng generator để match() dừng ngay khi gặp ứng viên phù hợp (lazy).
   */
  private *walk(
    node: TrieNode,
    segments: string[],
    index: number,
    values: string[],
  ): Generator<{ node: TrieNode; values: string[] }> {
    if (index === segments.length) {
      if (node.handlers) yield { node, values: [...values] };
      return;
    }

    const segment = segments[index];

    const staticChild = node.staticChildren.get(segment);
    if (staticChild) yield* this.walk(staticChild, segments, index + 1, values);

    // Tham số không được rỗng: `/users//orders` không khớp `/users/{id}/orders`.
    if (node.paramChild && segment !== '') {
      values.push(segment);
      yield* this.walk(node.paramChild, segments, index + 1, values);
      values.pop(); // backtrack
    }
  }
}

/**
 * Tách path thành các segment. Bỏ `/` đầu và `/` cuối (trừ root),
 * nên `/users/` và `/users` được coi là một.
 */
export function splitPath(pathname: string): string[] {
  const trimmed = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed === '' ? [] : trimmed.split('/');
}

/**
 * "Hình dạng" của path template, bỏ qua tên tham số: `/users/{id}` và `/users/{userId}`
 * cùng hình dạng `/users/{}`. Hai route cùng method + cùng hình dạng là xung đột.
 */
export function routeShape(template: string): string {
  return '/' + splitPath(template).map((s) => (PARAM_SEGMENT.test(s) ? '{}' : s)).join('/');
}

function stripQueryAndFragment(rawPath: string): string {
  const cut = rawPath.search(/[?#]/);
  return cut === -1 ? rawPath : rawPath.slice(0, cut);
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined; // percent-encoding hỏng, VD "%E0%A4%A"
  }
}

function createNode(): TrieNode {
  return { staticChildren: new Map() };
}
