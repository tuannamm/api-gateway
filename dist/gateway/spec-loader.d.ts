import type { OpenAPI, OpenAPIV3 } from 'openapi-types';
import { type RouteDefinition } from './types';
export interface LoadedSpec {
    title: string;
    version: string;
    routes: RouteDefinition[];
}
export declare function loadSpec(specPath: string): Promise<LoadedSpec>;
export declare function extractRoutes(api: OpenAPI.Document, specPath?: string): RouteDefinition[];
export declare const PERMISSIONS_EXTENSION = "x-required-permissions";
export declare function pickSuccessStatus(responses: OpenAPIV3.ResponsesObject | undefined): number;
