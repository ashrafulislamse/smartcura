import { Controller, Get } from '@nestjs/common';
import { PublicRoute } from '../platform/request-authorization.js';
import { OperationsService } from './operations.service.js';

@PublicRoute()
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('health')
  getHealth(): { status: 'ok'; version: string; time: string } {
    return this.operations.getHealth();
  }

  @Get('ready')
  async getReadiness(): Promise<{
    status: 'ready';
    checks: ReadonlyArray<{ name: string; ready: boolean }>;
    time: string;
  }> {
    return this.operations.getReadiness();
  }
}
