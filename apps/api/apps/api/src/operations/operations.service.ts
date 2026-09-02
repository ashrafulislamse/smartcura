import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  FoundationReadinessRepository,
  PostgresConnection,
} from '@smartcura/database';
import { createUuidV7, getCorrelationId } from '@smartcura/observability';
import type { ApiConfig } from '../config.js';
import {
  ProblemDetailsException,
  type ProblemDetails,
} from '../platform/problem-details.filter.js';
import { API_CONFIG } from '../tokens.js';

@Injectable()
export class OperationsService implements OnApplicationShutdown {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly database: PostgresConnection,
    private readonly readiness: FoundationReadinessRepository,
  ) {}

  /** Liveness probe — returns ok/version/timestamp. No DB access, no side effects. */
  getHealth(): { status: 'ok'; version: string; time: string } {
    return {
      status: 'ok',
      version: this.config.buildVersion,
      time: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<{
    status: 'ready';
    checks: ReadonlyArray<{ name: string; ready: boolean }>;
    time: string;
  }> {
    const postgresReady = await this.database.isReady();
    const checks = postgresReady
      ? [{ name: 'postgres', ready: true }, ...await this.readiness.check(this.config.workerMaxAgeMs)]
      : [{ name: 'postgres', ready: false }];
    if (checks.some((check) => !check.ready)) {
      const problem: ProblemDetails = {
        type: 'https://smartcura.example/problems/dependency-unavailable',
        title: 'Required dependency unavailable',
        status: 503,
        code: 'DEPENDENCY_UNAVAILABLE',
        correlation_id: getCorrelationId() ?? createUuidV7(),
        detail: 'One or more required dependencies are unavailable.',
      };
      throw new ProblemDetailsException(problem);
    }

    return {
      status: 'ready',
      checks,
      time: new Date().toISOString(),
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
