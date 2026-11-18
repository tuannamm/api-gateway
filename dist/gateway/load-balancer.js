"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoundRobinBalancer = void 0;
class RoundRobinBalancer {
    counters = new Map();
    order(key, instances) {
        if (instances.length <= 1)
            return [...instances];
        const sorted = [...instances].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const turn = this.counters.get(key) ?? 0;
        this.counters.set(key, (turn + 1) % sorted.length);
        const start = turn % sorted.length;
        return [...sorted.slice(start), ...sorted.slice(0, start)];
    }
}
exports.RoundRobinBalancer = RoundRobinBalancer;
//# sourceMappingURL=load-balancer.js.map