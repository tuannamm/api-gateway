import { ClientProxyFactory, Transport, type ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import type { Instance } from '../discovery/types';
import {
  RpcConnectionError,
  RpcPatternNotHandledError,
  RpcRemoteError,
  RpcTimeoutError,
  type RpcTransport,
} from './types';

/**
 * Adapter gửi message qua NestJS TCP transport (`ClientProxy.send(pattern, data)`).
 * Đây là file DUY NHẤT của core phụ thuộc NestJS: đổi transport thì chỉ thay file này.
 */

/** Chuỗi NestJS server trả về khi không có @MessagePattern khớp (constants.js: NO_MESSAGE_HANDLER). */
const NO_MESSAGE_HANDLER = 'There is no matching message handler defined in the remote service.';

/**
 * Mã lỗi xảy ra TRƯỚC khi kết nối được mở: request chắc chắn chưa tới service.
 * (ECONNREFUSED: không ai nghe ở cổng; EHOSTUNREACH/ENETUNREACH: không có đường tới máy;
 *  ENOTFOUND/EAI_AGAIN: không phân giải được tên miền.)
 */
const NOT_DELIVERED_CODES = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN']);

/**
 * Mã lỗi khi kết nối đứt giữa chừng: request CÓ THỂ đã tới và đã được xử lý.
 * ETIMEDOUT ở đây là timeout của socket, không phân biệt được lúc kết nối hay sau khi gửi,
 * nên xếp vào nhóm "không chắc" cho an toàn.
 */
const MAYBE_DELIVERED_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT']);

export class TcpTransport implements RpcTransport {
  /**
   * Connection pool: một ClientProxy (một socket TCP) cho mỗi "host:port", tái sử dụng giữa
   * các request. Mở socket mới cho mỗi request sẽ tốn thêm một vòng bắt tay TCP mỗi lần.
   */
  private readonly clients = new Map<string, ClientProxy>();

  async send(instance: Instance, pattern: string, payload: unknown, timeoutMs: number): Promise<unknown> {
    const key = `${instance.host}:${instance.port}`;
    const client = this.clientFor(key, instance);

    try {
      // send() trả Observable; timeout() bao cả thời gian kết nối lẫn thời gian chờ trả lời.
      // defaultValue: handler của service trả undefined thì Observable kết thúc mà không emit;
      // không có defaultValue thì firstValueFrom ném EmptyError.
      return await firstValueFrom(client.send(pattern, payload).pipe(timeout(timeoutMs)), {
        defaultValue: undefined,
      });
    } catch (error) {
      if (error instanceof TimeoutError) {
        throw new RpcTimeoutError(pattern, instance, timeoutMs);
      }
      const connection = classifyConnectionError(error);
      if (connection) {
        // ClientTCP cache cả promise kết nối THẤT BẠI; giữ client này thì mọi lần sau đều lỗi.
        // Bỏ khỏi pool để lần sau tạo client mới và kết nối lại.
        await this.evict(key);
        throw new RpcConnectionError(instance, error, connection === 'maybe-delivered');
      }
      if (error === NO_MESSAGE_HANDLER) {
        throw new RpcPatternNotHandledError(pattern, instance);
      }
      // Còn lại: lỗi do service ném ra (đã qua JSON nên là object thường, không phải Error).
      throw new RpcRemoteError(pattern, instance, error);
    }
  }

  async close(): Promise<void> {
    const keys = [...this.clients.keys()];
    await Promise.all(keys.map((key) => this.evict(key)));
  }

  /** Số kết nối đang giữ (dùng cho test và log). */
  get poolSize(): number {
    return this.clients.size;
  }

  private clientFor(key: string, instance: Instance): ClientProxy {
    let client = this.clients.get(key);
    if (!client) {
      // Kết nối mở lười (lazy): socket chỉ được mở ở lần send() đầu tiên.
      client = ClientProxyFactory.create({
        transport: Transport.TCP,
        options: { host: instance.host, port: instance.port },
      });
      this.clients.set(key, client);
    }
    return client;
  }

  private async evict(key: string): Promise<void> {
    const client = this.clients.get(key);
    this.clients.delete(key);
    try {
      await client?.close();
    } catch {
      // Đóng client đã hỏng có thể ném lỗi; không có gì để làm thêm.
    }
  }
}

/** Phân loại lỗi kết nối; undefined nghĩa là không phải lỗi kết nối. */
function classifyConnectionError(error: unknown): 'not-delivered' | 'maybe-delivered' | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as NodeJS.ErrnoException).code;
  if (code !== undefined && NOT_DELIVERED_CODES.has(code)) return 'not-delivered';
  if (code !== undefined && MAYBE_DELIVERED_CODES.has(code)) return 'maybe-delivered';
  // ClientTCP báo "Connection closed" cho request đang chờ khi socket đóng: có thể đã gửi.
  if (error.message === 'Connection closed') return 'maybe-delivered';
  return undefined;
}
