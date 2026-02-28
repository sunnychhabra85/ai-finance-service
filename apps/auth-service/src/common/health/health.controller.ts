// =============================================================
// apps/auth-service/src/common/health/health.controller.ts
// =============================================================

import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DatabaseService } from '@finance/database';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  // ── GET /api/v1/health ────────────────────────────────────────
  // Kubernetes Liveness Probe: Is the service alive?
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check (liveness probe)' })
  liveness() {
    return {
      status: 'ok',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
    };
  }

  // ── GET /api/v1/health/ready ──────────────────────────────────
  // Kubernetes Readiness Probe: Is the service ready to accept traffic?
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks DB connectivity' })
  async readiness() {
    const dbHealthy = await this.db.isHealthy();

    if (!dbHealthy) {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'auth-service',
        checks: { database: 'DOWN' },
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'ok',
      service: 'auth-service',
      checks: { database: 'UP' },
      timestamp: new Date().toISOString(),
    };
  }
}
