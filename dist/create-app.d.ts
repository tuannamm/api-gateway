import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type Gateway } from './gateway';
export declare function createGatewayApp(gateway: Gateway): Promise<NestFastifyApplication>;
