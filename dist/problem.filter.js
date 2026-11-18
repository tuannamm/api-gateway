"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProblemExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
const gateway_1 = require("./gateway");
const CODE_BY_STATUS = {
    400: 'BAD_REQUEST',
    413: 'PAYLOAD_TOO_LARGE',
    415: 'UNSUPPORTED_MEDIA_TYPE',
};
let ProblemExceptionFilter = class ProblemExceptionFilter {
    logger = new common_1.Logger('Gateway');
    catch(exception, host) {
        const http = host.switchToHttp();
        const request = http.getRequest();
        const reply = http.getResponse();
        const requestId = (0, gateway_1.resolveRequestId)(request.headers[gateway_1.REQUEST_ID_HEADER]);
        const error = this.toGatewayError(exception, requestId);
        void reply
            .status(error.status)
            .header(gateway_1.REQUEST_ID_HEADER, requestId)
            .header('content-type', gateway_1.PROBLEM_CONTENT_TYPE)
            .send(JSON.stringify((0, gateway_1.toProblem)(error, requestId, request.url.split('?')[0])));
    }
    toGatewayError(exception, requestId) {
        if (exception instanceof common_1.HttpException && exception.getStatus() < 500) {
            const status = exception.getStatus();
            return new gateway_1.GatewayError(status, CODE_BY_STATUS[status] ?? `HTTP_${status}`, exception.message);
        }
        this.logger.error(`[${requestId}] unexpected error: ${exception?.stack ?? String(exception)}`);
        return new gateway_1.GatewayError(500, 'INTERNAL_ERROR', 'Unexpected gateway error');
    }
};
exports.ProblemExceptionFilter = ProblemExceptionFilter;
exports.ProblemExceptionFilter = ProblemExceptionFilter = __decorate([
    (0, common_1.Catch)()
], ProblemExceptionFilter);
//# sourceMappingURL=problem.filter.js.map