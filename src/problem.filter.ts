import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { GatewayError, PROBLEM_CONTENT_TYPE, REQUEST_ID_HEADER, resolveRequestId, toProblem } from './gateway';

/**
 * Bắt lỗi xảy ra TRƯỚC khi request tới GatewayController, do Fastify phát hiện khi đọc body:
 * body quá lớn (413), content-type không hỗ trợ (415), JSON hỏng (400).
 *
 * NestJS đăng ký error handler riêng với Fastify (ghi đè handler ta tự đặt), rồi chuyển lỗi
 * thành HttpException(message, statusCode) và đưa vào chuỗi exception filter. Vì vậy chỗ đúng
 * để can thiệp là một exception filter toàn cục, không phải fastify.setErrorHandler.
 *
 * Lỗi trong GatewayHandler KHÔNG đi qua đây: handler tự bắt và trả problem+json.
 */
const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
};

@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Gateway');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = resolveRequestId(request.headers[REQUEST_ID_HEADER]);

    const error = this.toGatewayError(exception, requestId);
    void reply
      .status(error.status)
      .header(REQUEST_ID_HEADER, requestId)
      .header('content-type', PROBLEM_CONTENT_TYPE)
      .send(JSON.stringify(toProblem(error, requestId, request.url.split('?')[0])));
  }

  private toGatewayError(exception: unknown, requestId: string): GatewayError {
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      return new GatewayError(status, CODE_BY_STATUS[status] ?? `HTTP_${status}`, exception.message);
    }
    this.logger.error(`[${requestId}] unexpected error: ${(exception as Error)?.stack ?? String(exception)}`);
    return new GatewayError(500, 'INTERNAL_ERROR', 'Unexpected gateway error');
  }
}
