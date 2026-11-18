import type { MatchResult, RouteDefinition } from './types';
export declare class RouteTable {
    private readonly root;
    private count;
    static from(routes: readonly RouteDefinition[]): RouteTable;
    get size(): number;
    insert(route: RouteDefinition): void;
    match(method: string, rawPath: string): MatchResult;
    private walk;
}
export declare function splitPath(pathname: string): string[];
export declare function routeShape(template: string): string;
