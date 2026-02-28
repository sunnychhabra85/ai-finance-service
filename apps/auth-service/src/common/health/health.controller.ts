// =============================================================
// apps/auth-service/src/common/health/health.controller.ts
//
// TWO endpoints used by Kubernetes:
//
//   GET /api/v1/health        → Liveness probe
//     "Is the Node process alive?" — always returns 200 if the
//     process is running. Kubernetes restarts the pod if this fails.
//
//   GET /api/v1/health/ready  → Readiness probe
//     "Is the service ready to handle requests?" — checks DB.
//     Returns 503 if DB is down. Kubernetes stops sending traffic
//     to this pod until it returns 200 again.
// =============================================================

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  // NestJS injects HealthService here — works because HealthModule
  // lists it in `providers`. Without that, `this.health` would be undefined.
  constructor(private readonly health: HealthService) {}

  // ── GET /api/v1/health ──────────────────────────────────────
  // Liveness: just confirms the process hasn't crashed
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe — process is running' })
  liveness() {
    return {
      status: 'ok',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
    };
  }

  // ── GET /api/v1/health/ready ────────────────────────────────
  // Readiness: confirms DB connection is live before accepting traffic
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks DB connectivity' })
  async readiness() {
    const dbHealthy = await this.health.isHealthy();

    if (!dbHealthy) {
      // 503 tells Kubernetes: "don't send traffic here yet"
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
