"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROBLEM_CONTENT_TYPE = exports.GatewayError = void 0;
exports.toProblem = toProblem;
const node_http_1 = require("node:http");
class GatewayError extends Error {
    status;
    code;
    headers;
    details;
    constructor(status, code, message, headers = {}, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.headers = headers;
        this.details = details;
        this.name = 'GatewayError';
    }
}
exports.GatewayError = GatewayError;
exports.PROBLEM_CONTENT_TYPE = 'application/problem+json';
function toProblem(error, requestId, instance) {
    return {
        type: 'about:blank',
        title: node_http_1.STATUS_CODES[error.status] ?? 'Error',
        status: error.status,
        detail: error.message,
        instance,
        code: error.code,
        requestId,
        ...(error.details !== undefined && { details: error.details }),
    };
}
//# sourceMappingURL=problem.js.map