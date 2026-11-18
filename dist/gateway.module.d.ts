import { type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { type Gateway } from './gateway';
export declare class GatewayModule implements OnApplicationShutdown {
    private readonly gateway;
    constructor(gateway: Gateway);
    static forRoot(gateway: Gateway): DynamicModule;
    onApplicationShutdown(): Promise<void>;
}
