import type { FastifyReply, FastifyRequest } from 'fastify';
import { GatewayHandler } from './gateway';
export declare class GatewayController {
    private readonly handler;
    constructor(handler: GatewayHandler);
    proxy(request: FastifyRequest, reply: FastifyReply): Promise<void>;
}
