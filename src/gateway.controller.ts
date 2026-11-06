import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { GatewayHandler } from './gateway';

/**
 * CATCH-ALL: một handler nhận MỌI method, MỌI path. Không có controller theo từng route,
 * vì route đến từ file spec lúc chạy, không phải từ code.
 *
 * Controller chỉ là lớp mỏng: chuyển request Fastify → object thuần cho GatewayHandler,
 * rồi ghi kết quả ra response. Không có logic nghiệp vụ ở đây.
 */
@Controller()
export class GatewayController {
  constructor(@Inject(GatewayHandler) private readonly handler: GatewayHandler) {}

  // Với Fastify, NestJS chuyển path NGUYÊN VĂN cho router của Fastify (find-my-way),
  // nên phải dùng cú pháp wildcard của Fastify: "*" (khớp mọi path, kể cả "/").
  // Cú pháp "{*path}" trong tài liệu NestJS 11+ là của Express (path-to-regexp), Fastify báo lỗi
  // "Wildcard must be the last character in the route".
  @All('*')
  async proxy(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const response = await this.handler.handle({
      method: request.method,
      url: request.url, // URL gốc chưa decode: RouteTable tự decode tham số sau khi match
      headers: request.headers,
      body: request.body,
    });

    reply.status(response.status).headers(response.headers);
    if (response.body === undefined) {
      await reply.send();
    } else {
      // Tự serialize để body null vẫn ra "null" hợp lệ thay vì rỗng.
      await reply.send(JSON.stringify(response.body));
    }
  }
}
