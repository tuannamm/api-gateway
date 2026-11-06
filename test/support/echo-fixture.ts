import { Controller, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MessagePattern, Payload, RpcException, Transport, type MicroserviceOptions } from '@nestjs/microservices';
import type { INestMicroservice } from '@nestjs/common';
import { createServer } from 'node:net';
import type { GatewayRequest, GatewayRpcError } from '../../src/gateway';

/**
 * Microservice TCP giả, chạy ngay trong process của test.
 * Mỗi handler mô phỏng một kiểu hành vi của service thật.
 */
@Controller()
class EchoFixtureController {
  /** Trả lại payload; "missing" → lỗi nghiệp vụ 404; "slow" → chậm hơn timeout. */
  @MessagePattern('user.getById')
  async getById(@Payload() req: GatewayRequest) {
    if (req.params.id === 'missing') {
      throw new RpcException({
        statusCode: 404,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      } satisfies GatewayRpcError);
    }
    if (req.params.id === 'slow') await new Promise((r) => setTimeout(r, 1_000));
    return { echo: req };
  }

  @MessagePattern('user.create')
  create(@Payload() req: GatewayRequest) {
    return { created: req.body };
  }

  /** Không trả gì: gateway phải trả 204 không body (spec khai báo 204). */
  @MessagePattern('user.remove')
  remove(): void {
    return undefined;
  }

  /** Ném Error thường, KHÔNG theo hợp đồng → gateway trả 502 UPSTREAM_ERROR. */
  @MessagePattern('user.list')
  list(): never {
    throw new Error('database exploded');
  }

  // Cố ý KHÔNG có handler cho "user.getMe" → gateway trả 502 PATTERN_NOT_HANDLED.
}

@Module({ controllers: [EchoFixtureController] })
class EchoFixtureModule {}

export async function startEchoFixture(port: number): Promise<INestMicroservice> {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(EchoFixtureModule, {
    transport: Transport.TCP,
    options: { host: '127.0.0.1', port },
    logger: false,
  });
  await app.listen();
  return app;
}

/** Lấy một cổng TCP đang trống (mở cổng 0 để hệ điều hành chọn, rồi đóng lại). */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}
