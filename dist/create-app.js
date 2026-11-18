"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGatewayApp = createGatewayApp;
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const gateway_1 = require("./gateway");
const gateway_module_1 = require("./gateway.module");
const problem_filter_1 = require("./problem.filter");
async function createGatewayApp(gateway) {
    const adapter = new platform_fastify_1.FastifyAdapter({ bodyLimit: gateway.config.bodyLimit, routerOptions: {
            onBadUrl: (path, request, response) => {
                const requestId = (0, gateway_1.resolveRequestId)(request.headers[gateway_1.REQUEST_ID_HEADER]);
                response.writeHead(400, { 'content-type': gateway_1.PROBLEM_CONTENT_TYPE, [gateway_1.REQUEST_ID_HEADER]: requestId });
                response.end(JSON.stringify((0, gateway_1.toProblem)(new gateway_1.GatewayError(400, 'INVALID_PATH', 'Path contains malformed percent-encoding'), requestId, path.split('?')[0])));
            },
        } });
    adapter.getInstance().removeContentTypeParser('text/plain');
    const app = await core_1.NestFactory.create(gateway_module_1.GatewayModule.forRoot(gateway), adapter, {
        logger: ['error', 'warn', 'log'],
    });
    app.useGlobalFilters(new problem_filter_1.ProblemExceptionFilter());
    app.enableShutdownHooks();
    return app;
}
//# sourceMappingURL=create-app.js.map