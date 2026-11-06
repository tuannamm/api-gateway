import { Logger } from '@nestjs/common';
import { createGatewayApp } from './create-app';
import { buildGateway, loadConfig, type Gateway } from './gateway';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Gateway');

  // CONTROL PLANE trước: config + spec + discovery. Sai thì dừng ngay, không mở cổng.
  let gateway: Gateway;
  try {
    gateway = await buildGateway(loadConfig(), {
      warn: (message) => logger.warn(message),
      error: (message) => logger.error(message),
    });
  } catch (error) {
    logger.error((error as Error).message);
    process.exit(1);
  }

  const { config, spec, unservedPatterns } = gateway;
  logger.log(`Project "${config.project}": ${spec.title} v${spec.version}, ${spec.routes.length} route(s)`);
  if (unservedPatterns.length > 0) {
    logger.warn(`No instance registered for: ${unservedPatterns.join(', ')} (requests will get 503)`);
  }

  // DATA PLANE: mở cổng nhận request.
  const app = await createGatewayApp(gateway);
  await app.listen(config.port, '0.0.0.0');
  logger.log(`Listening on http://localhost:${config.port}`);
}

void bootstrap();
