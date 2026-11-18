"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSIONS_EXTENSION = void 0;
exports.loadSpec = loadSpec;
exports.extractRoutes = extractRoutes;
exports.pickSuccessStatus = pickSuccessStatus;
const swagger_parser_1 = __importDefault(require("@apidevtools/swagger-parser"));
const errors_1 = require("./errors");
const route_table_1 = require("./route-table");
const types_1 = require("./types");
async function loadSpec(specPath) {
    let api;
    try {
        api = await swagger_parser_1.default.validate(specPath);
    }
    catch (error) {
        throw new errors_1.SpecValidationError(specPath, [error.message]);
    }
    return {
        title: api.info.title,
        version: api.info.version,
        routes: extractRoutes(api, specPath),
    };
}
function extractRoutes(api, specPath = '<in-memory>') {
    if (!('openapi' in api) || !String(api.openapi).startsWith('3.')) {
        throw new errors_1.SpecValidationError(specPath, [
            'Only OpenAPI 3.x is supported (found Swagger 2.0 or unknown version).',
        ]);
    }
    const issues = [];
    for (const [name, scheme] of Object.entries(api.components?.securitySchemes ?? {})) {
        if (!('type' in scheme) || scheme.type !== 'http' || scheme.scheme.toLowerCase() !== 'bearer') {
            issues.push(`Unsupported security scheme: ${name}`);
        }
    }
    const validateSecurity = (security) => {
        if (!security)
            return;
        for (const requirement of security) {
            const names = Object.keys(requirement);
            if (names.length !== 1 || names.some(name => !api.components?.securitySchemes?.[name] || requirement[name].length !== 0)) {
                issues.push('Only bearer security requirements with empty scopes are supported');
            }
        }
    };
    validateSecurity(api.security);
    const routes = [];
    const operationIds = new Map();
    const shapes = new Map();
    const paths = api.paths ?? {};
    for (const [pathTemplate, pathItem] of Object.entries(paths)) {
        if (!pathItem)
            continue;
        for (const method of types_1.HTTP_METHODS) {
            const operation = pathItem[method];
            if (!operation)
                continue;
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
            const shapeKey = `${method} ${(0, route_table_1.routeShape)(pathTemplate)}`;
            const sameShape = shapes.get(shapeKey);
            if (sameShape) {
                issues.push(`${where}: ambiguous with ${method.toUpperCase()} ${sameShape} (same path shape).`);
                continue;
            }
            shapes.set(shapeKey, pathTemplate);
            const requiresAuth = !(operation.security?.length === 0 || (operation.security === undefined && api.security?.length === 0));
            const permissions = readPermissions(operation, requiresAuth, where, issues);
            if (permissions === 'invalid')
                continue;
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
    if (issues.length > 0)
        throw new errors_1.SpecValidationError(specPath, issues);
    return routes;
}
const PERMISSION_KEY = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
exports.PERMISSIONS_EXTENSION = 'x-required-permissions';
function readPermissions(operation, requiresAuth, where, issues) {
    const raw = operation[exports.PERMISSIONS_EXTENSION];
    if (!requiresAuth) {
        if (raw === undefined)
            return undefined;
        issues.push(`${where}: public route (security: []) must not declare ${exports.PERMISSIONS_EXTENSION}.`);
        return 'invalid';
    }
    if (raw === undefined) {
        issues.push(`${where}: missing ${exports.PERMISSIONS_EXTENSION} (use [] when any authenticated user may call it).`);
        return 'invalid';
    }
    if (!Array.isArray(raw) || raw.some((key) => typeof key !== 'string' || !PERMISSION_KEY.test(key))) {
        issues.push(`${where}: ${exports.PERMISSIONS_EXTENSION} must be an array of "resource:action" keys.`);
        return 'invalid';
    }
    if (new Set(raw).size !== raw.length) {
        issues.push(`${where}: ${exports.PERMISSIONS_EXTENSION} contains duplicate keys.`);
        return 'invalid';
    }
    return [...raw];
}
function pickSuccessStatus(responses) {
    const codes = Object.keys(responses ?? {})
        .map((key) => (key.toUpperCase() === '2XX' ? 200 : Number(key)))
        .filter((code) => Number.isInteger(code) && code >= 200 && code < 300)
        .sort((a, b) => a - b);
    return codes[0] ?? 200;
}
//# sourceMappingURL=spec-loader.js.map