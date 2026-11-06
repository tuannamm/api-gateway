import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayHandler, type Gateway } from './gateway';

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
    return {
      module: GatewayModule,
      controllers: [GatewayController],
      providers: [
        { provide: GATEWAY, useValue: gateway },
        { provide: GatewayHandler, useValue: gateway.handler },
      ],
    };
  }

  /** Graceful shutdown: đóng mọi kết nối TCP tới service khi app tắt (SIGTERM, app.close()). */
  async onApplicationShutdown(): Promise<void> {
    await this.gateway.transport.close();
  }
}
