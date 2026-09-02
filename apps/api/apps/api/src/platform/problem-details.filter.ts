import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { AbstractHttpAdapter } from '@nestjs/core';
import { SerializationConflictError } from '@smartcura/database';
import {
  createUuidV7,
  formatSafeLog,
  getCorrelationId,
  safeErrorFields,
} from '@smartcura/observability';

export interface FieldViolation {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly correlation_id: string;
  readonly detail?: string | null;
  readonly errors?: ReadonlyArray<FieldViolation>;
}

export class ProblemDetailsException extends HttpException {
  constructor(problem: ProblemDetails) {
    super(problem, problem.status);
  }
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  readonly #logger = new Logger(ProblemDetailsFilter.name);

  constructor(private readonly httpAdapter: AbstractHttpAdapter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<unknown>();
    const problem = this.toProblem(exception);
    // A 500 previously produced NO log line at all, which made an unhandled
    // exception undiagnosable in production and silently contradicted the
    // observability requirements. Server faults are now recorded through the
    // allowlist projection: a stable classification and correlation id, never the
    // exception message, because driver messages quote the offending value.
    if (problem.status >= 500) {
      this.#logger.error(formatSafeLog({
        event: 'http.unhandled_error',
        correlation_id: problem.correlation_id,
        http_status: problem.status,
        ...safeErrorFields(exception),
      }));
      // The stack is written separately and only outside production, so a
      // developer can debug locally without shipping frames that may quote data.
      if (process.env.NODE_ENV !== 'production' && exception instanceof Error) {
        this.#logger.debug(exception.stack ?? exception.name);
      }
    }
    this.httpAdapter.setHeader(response, 'Content-Type', 'application/problem+json');
    this.httpAdapter.setHeader(response, 'x-correlation-id', problem.correlation_id);
    this.httpAdapter.reply(response, problem, problem.status);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof ProblemDetailsException) {
      return exception.getResponse() as ProblemDetails;
    }
    // Contention is a retryable client-visible outcome, not a server fault. Without
    // this mapping an exhausted SERIALIZABLE retry surfaced as a 500, which real
    // concurrency verification caught among a batch of parallel losers.
    if (exception instanceof SerializationConflictError) {
      return {
        type: 'https://smartcura.example/problems/serialization-conflict',
        title: 'Concurrent modification, please retry',
        status: 409,
        code: 'SERIALIZATION_CONFLICT',
        correlation_id: getCorrelationId() ?? createUuidV7(),
      };
    }
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const code = status === 404 ? 'RESOURCE_NOT_FOUND' : status < 500 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR';
    return {
      type: `https://smartcura.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
      title: status === 404 ? 'Resource not found' : status < 500 ? 'Request rejected' : 'Internal server error',
      status,
      code,
      correlation_id: getCorrelationId() ?? createUuidV7(),
    };
  }
}
