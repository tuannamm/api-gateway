"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUEST_ID_HEADER = void 0;
exports.resolveRequestId = resolveRequestId;
const node_crypto_1 = require("node:crypto");
exports.REQUEST_ID_HEADER = 'x-request-id';
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
function resolveRequestId(header) {
    const value = Array.isArray(header) ? header[0] : header;
    return value !== undefined && VALID_REQUEST_ID.test(value) ? value : (0, node_crypto_1.randomUUID)();
}
//# sourceMappingURL=request-id.js.map