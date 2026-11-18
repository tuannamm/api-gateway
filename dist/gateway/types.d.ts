export declare const HTTP_METHODS: readonly ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
export type HttpMethod = (typeof HTTP_METHODS)[number];
export interface RouteDefinition {
    method: HttpMethod;
    path: string;
    operationId: string;
    successStatus: number;
    requiresAuth?: boolean;
    permissions?: readonly string[];
}
export type MatchResult = {
    kind: 'found';
    route: RouteDefinition;
    params: Record<string, string>;
} | {
    kind: 'not_found';
} | {
    kind: 'method_not_allowed';
    allowed: HttpMethod[];
} | {
    kind: 'invalid_path';
};
