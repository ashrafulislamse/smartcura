import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { json } from 'express';
import { AppModule } from './app.module.js';
import { loadApiConfig } from './config.js';
import { ProblemDetailsFilter } from './platform/problem-details.filter.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  // The built-in parser is disabled so a single parser handles both media types.
  // Profile updates are RFC 7396 merge-patch documents, and Nest's default parser
  // accepts only `application/json`. Registering a second parser alongside the
  // default is not equivalent: under Express 5 the skipping parser resets
  // `req.body`, discarding a body the first parser had already read.
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot(config),
    { bodyParser: false },
  );
  const { httpAdapter } = app.get(HttpAdapterHost);

  app.use(json({
    type: ['application/json', 'application/merge-patch+json'],
    limit: '64kb',
  }));

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: [...config.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'X-Correlation-ID', 'Idempotency-Key'],
    exposedHeaders: ['X-Correlation-ID'],
  });
  // Socket.IO adapter so the ChatGateway (namespace '/chat') is served on the
  // same HTTP server as the REST API. The adapter shares the Express listener,
  // so the WebSocket handshake reuses the same TLS termination and the same
  // origin as the REST surface; no second port is opened.
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useGlobalFilters(new ProblemDetailsFilter(httpAdapter));
  app.enableShutdownHooks();

  await app.listen(config.port, config.host);
  console.log(JSON.stringify({
    event: 'api.started',
    host: config.host,
    port: config.port,
    version: config.buildVersion,
  }));
}

bootstrap().catch((error) => {
  console.error(JSON.stringify({ event: 'api.start_failed', error: error?.message ?? String(error) }));
  process.exitCode = 1;
});
