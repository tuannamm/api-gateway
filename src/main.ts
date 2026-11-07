import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { createGatewayApp } from './create-app';
import { buildGateway, loadConfig, type Gateway } from './gateway';

// Chạy local: nạp .env (nếu có) bằng API sẵn của Node, không cần dotenv.
// Biến đã có trong môi trường (export, Docker) KHÔNG bị ghi đè, nên production vẫn cấu hình bằng env.
if (existsSync('.env')) process.loadEnvFile('.env');

async function bootstrap(): Promise<void> {
  const logger = new Logger('Gateway');

  // CONTROL PLANE trước: config + spec + discovery. Sai thì dừng ngay, không mở cổng.
  let gateway: Gateway;
  try {
    gateway = await buildGateway(loadConfig(), {
      log: (message) => logger.log(message),
      warn: (message) => logger.warn(message),
      error: (message) => logger.error(message),
    });
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  const { config, spec, unservedPatterns } = gateway;
  logger.log(`Project "${config.project}": ${spec.title} v${spec.version}, ${spec.routes.length} route(s)`);
  logger.log(`Discovery: registry ${config.discovery.url} (poll every ${config.discovery.pollIntervalMs}ms)`);
  if (unservedPatterns.length > 0) {
    logger.warn(`No instance registered for: ${unservedPatterns.join(', ')} (requests will get 503)`);
  }

  // DATA PLANE: mở cổng nhận request.
  const app = await createGatewayApp(gateway);
  await app.listen(config.port, '0.0.0.0');
  logger.log(`Listening on http://localhost:${config.port}`);
}

void bootstrap();
