import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadWorkerConfig } from './config.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const config = loadWorkerConfig(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config));
  app.enableShutdownHooks();
  console.log(JSON.stringify({ event: 'worker.started', version: config.buildVersion }));
}

bootstrap().catch((error) => {
  console.error(JSON.stringify({ event: 'worker.start_failed', error: error?.message ?? String(error) }));
  process.exitCode = 1;
});
