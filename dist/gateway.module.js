"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var GatewayModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayModule = void 0;
const common_1 = require("@nestjs/common");
const gateway_controller_1 = require("./gateway.controller");
const gateway_1 = require("./gateway");
const GATEWAY = Symbol('GATEWAY');
let GatewayModule = GatewayModule_1 = class GatewayModule {
    gateway;
    constructor(gateway) {
        this.gateway = gateway;
    }
    static forRoot(gateway) {
        return {
            module: GatewayModule_1,
            controllers: [gateway_controller_1.GatewayController],
            providers: [
                { provide: GATEWAY, useValue: gateway },
                { provide: gateway_1.GatewayHandler, useValue: gateway.handler },
            ],
        };
    }
    async onApplicationShutdown() {
        this.gateway.discovery.close?.();
        await this.gateway.transport.close();
    }
};
exports.GatewayModule = GatewayModule;
exports.GatewayModule = GatewayModule = GatewayModule_1 = __decorate([
    (0, common_1.Module)({}),
    __param(0, (0, common_1.Inject)(GATEWAY)),
    __metadata("design:paramtypes", [Object])
], GatewayModule);
//# sourceMappingURL=gateway.module.js.map