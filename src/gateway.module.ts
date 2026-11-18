import { Inject, Module, type DynamicModule, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GatewayController } from './gateway.controller';
import { RedisModule, RedisService } from '@lib-infrastructure/redis';
import { FixedWindowRateLimiter, GatewayHandler, type Gateway } from './gateway';
import { RedisFixedWindowStore } from './redis-fixed-window.store';
import { RATE_LIMITER, RateLimitGuard } from './rate-limit.guard';

const GATEWAY = Symbol('GATEWAY');

/**
 * Dynamic module: nhận Gateway ĐÃ DỰNG XONG (control plane chạy trước, ngoài NestJS)
 * và chỉ làm nhiệm vụ đưa nó vào DI container của NestJS.
 * Vì vậy lỗi spec/config làm process dừng TRƯỚC khi NestJS khởi động.
 */
@Module({})
export class GatewayModule implements OnApplicationShutdown {
  constructor(@Inject(GATEWAY) private readonly gateway: Gateway) {}

  static forRoot(gateway: Gateway): DynamicModule {
    const { rateLimit } = gateway.config;
    // Rate limit tuỳ chọn: chỉ đăng ký guard khi GATEWAY_RATE_LIMIT_MAX được đặt.
    const rateLimitProviders: Provider[] = rateLimit
      ? [
          {
            provide: RATE_LIMITER,
            inject: [RedisService],
            useFactory: (redis: RedisService) =>
              new FixedWindowRateLimiter(new RedisFixedWindowStore(redis, `gateway:${gateway.config.project}:ratelimit`), rateLimit),
          },
          { provide: APP_GUARD, useClass: RateLimitGuard },
        ]
      : [];
    return {
      module: GatewayModule,
      // RedisModule (cần REDIS_URI) chỉ được nạp khi bật rate limit.
      imports: rateLimit ? [RedisModule] : [],
      controllers: [GatewayController],
      providers: [
        { provide: GATEWAY, useValue: gateway },
        { provide: GatewayHandler, useValue: gateway.handler },
        ...rateLimitProviders,
      ],
    };
  }

  /** Graceful shutdown: dừng poll registry và đóng mọi kết nối TCP tới service (SIGTERM, app.close()). */
  async onApplicationShutdown(): Promise<void> {
    this.gateway.discovery.close?.();
    await this.gateway.transport.close();
  }
}
