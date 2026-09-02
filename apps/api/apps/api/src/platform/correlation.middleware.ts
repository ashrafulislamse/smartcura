import { Injectable, type NestMiddleware } from '@nestjs/common';
import {
  createUuidV7,
  isUuidV7,
  withCorrelation,
} from '@smartcura/observability';

interface RequestLike {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

interface ResponseLike {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(request: RequestLike, response: ResponseLike, next: () => void): void {
    const supplied = request.headers['x-correlation-id'];
    const candidate = typeof supplied === 'string' ? supplied : undefined;
    const correlationId = candidate !== undefined && isUuidV7(candidate)
      ? candidate.toLowerCase()
      : createUuidV7();
    response.setHeader('x-correlation-id', correlationId);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    withCorrelation(correlationId, next);
  }
}
