"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RouteTable = void 0;
exports.splitPath = splitPath;
exports.routeShape = routeShape;
const PARAM_SEGMENT = /^\{([^{}]+)\}$/;
class RouteTable {
    root = createNode();
    count = 0;
    static from(routes) {
        const table = new RouteTable();
        for (const route of routes)
            table.insert(route);
        return table;
    }
    get size() {
        return this.count;
    }
    insert(route) {
        let node = this.root;
        const paramNames = [];
        for (const segment of splitPath(route.path)) {
            const param = PARAM_SEGMENT.exec(segment);
            if (param) {
                paramNames.push(param[1]);
                node.paramChild ??= createNode();
                node = node.paramChild;
            }
            else {
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
            throw new Error(`Route conflict: ${route.method.toUpperCase()} ${route.path} (${route.operationId}) ` +
                `has the same shape as ${existing.route.path} (${existing.route.operationId})`);
        }
        node.handlers.set(route.method, { route, paramNames });
        this.count++;
    }
    match(method, rawPath) {
        const wanted = method.toLowerCase();
        const segments = splitPath(stripQueryAndFragment(rawPath));
        const allowed = new Set();
        for (const candidate of this.walk(this.root, segments, 0, [])) {
            const handler = candidate.node.handlers.get(wanted);
            if (!handler) {
                for (const m of candidate.node.handlers.keys())
                    allowed.add(m);
                continue;
            }
            const params = {};
            for (let i = 0; i < handler.paramNames.length; i++) {
                const decoded = safeDecode(candidate.values[i]);
                if (decoded === undefined)
                    return { kind: 'invalid_path' };
                params[handler.paramNames[i]] = decoded;
            }
            return { kind: 'found', route: handler.route, params };
        }
        return allowed.size > 0
            ? { kind: 'method_not_allowed', allowed: [...allowed].sort() }
            : { kind: 'not_found' };
    }
    *walk(node, segments, index, values) {
        if (index === segments.length) {
            if (node.handlers)
                yield { node, values: [...values] };
            return;
        }
        const segment = segments[index];
        const staticChild = node.staticChildren.get(segment);
        if (staticChild)
            yield* this.walk(staticChild, segments, index + 1, values);
        if (node.paramChild && segment !== '') {
            values.push(segment);
            yield* this.walk(node.paramChild, segments, index + 1, values);
            values.pop();
        }
    }
}
exports.RouteTable = RouteTable;
function splitPath(pathname) {
    const trimmed = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    return trimmed === '' ? [] : trimmed.split('/');
}
function routeShape(template) {
    return '/' + splitPath(template).map((s) => (PARAM_SEGMENT.test(s) ? '{}' : s)).join('/');
}
function stripQueryAndFragment(rawPath) {
    const cut = rawPath.search(/[?#]/);
    return cut === -1 ? rawPath : rawPath.slice(0, cut);
}
function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return undefined;
    }
}
function createNode() {
    return { staticChildren: new Map() };
}
//# sourceMappingURL=route-table.js.map