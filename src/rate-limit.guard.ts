import { Inject, Injectable, Logger, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { GatewayError, type FixedWindowRateLimiter } from './gateway';

export const RATE_LIMITER = Symbol('RATE_LIMITER');

/**
 * Guard toàn cục: đếm request theo IP client (fixed window), quá hạn mức thì 429.
 * Store lỗi (Redis down) thì fail-open. Guard chạy SAU khi Fastify đã đọc body, nên body quá lớn vẫn bị parse trước khi bị tính.
 *
 * Sau reverse proxy, `request.ip` là IP của proxy trừ khi bật `trustProxy` ở FastifyAdapter.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');

  constructor(@Inject(RATE_LIMITER) private readonly limiter: FixedWindowRateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    let result;
    try {
      result = await this.limiter.consume(request.ip);
    } catch {
      // FAIL-OPEN: Redis lỗi thì cho request đi tiếp, tránh việc Redis chết kéo cả gateway chết theo.
      // Đổi thành ném 503 nếu muốn fail-closed (an toàn hơn nhưng phụ thuộc Redis).
      this.logger.warn('Rate limit store unavailable, allowing request');
      return true;
    }
    reply.header('x-ratelimit-limit', String(result.limit));
    reply.header('x-ratelimit-remaining', String(result.remaining));
    reply.header('x-ratelimit-reset', String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      throw new GatewayError(429, 'RATE_LIMITED', 'Too many requests, please retry later', {
        'retry-after': String(result.retryAfterSec),
      });
    }
    return true;
  }
}
