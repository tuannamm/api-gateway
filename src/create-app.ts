import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Gateway } from './gateway';
import { GatewayModule } from './gateway.module';
import { ProblemExceptionFilter } from './problem.filter';

/**
 * Dựng NestJS app (Fastify) quanh một Gateway đã dựng xong.
 * Tách khỏi main.ts để e2e test dựng đúng app như production, chỉ khác Gateway truyền vào.
 */
export async function createGatewayApp(gateway: Gateway): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({ bodyLimit: gateway.config.bodyLimit });

  // Chỉ nhận body JSON. Mặc định Fastify còn parse text/plain; bỏ đi để mọi loại khác → 415.
  adapter.getInstance().removeContentTypeParser('text/plain');

  const app = await NestFactory.create<NestFastifyApplication>(GatewayModule.forRoot(gateway), adapter, {
    logger: ['error', 'warn', 'log'],
  });
  app.useGlobalFilters(new ProblemExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
