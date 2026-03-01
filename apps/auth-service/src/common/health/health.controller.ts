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
//
// PRODUCTION SAFETY RULES:
//   1. Liveness  → NEVER checks external dependencies (DB, Redis, etc.).
//      If it throws or returns non-2xx, Kubernetes RESTARTS the pod.
//      An overly strict liveness probe causes restart loops.
//   2. Readiness → checks dependencies; returns 503 when unavailable.
//      Kubernetes just removes the pod from the load-balancer until it
//      recovers — it does NOT restart the process.
//   3. ALL branches in readiness() MUST be wrapped in try/catch so that
//      unexpected exceptions become 503 (ServiceUnavailable), never 500.
//      A 500 on the readiness endpoint causes the same behaviour as a
//      503, but it makes the logs confusing and can mask real bugs.
// =============================================================

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
@SkipThrottle() // Health probes must NOT be rate-limited — they fire every 10-15 s
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  // NestJS injects HealthService here — works ONLY because HealthModule
  // lists it in `providers`. Without that entry, `this.health` is
  // undefined at runtime → "Cannot read properties of undefined"
  // (the original crash that caused the rollout failure).
  constructor(private readonly health: HealthService) {}

  // ── GET /api/v1/health ──────────────────────────────────────
  // Liveness probe: does NOT call any external dependency.
  // Returning 200 simply confirms the Node process is alive.
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
  // Readiness probe: checks the database before accepting traffic.
  //
  // IMPORTANT: the entire method body is wrapped in try/catch.
  // If HealthService.isHealthy() throws for ANY reason — including
  // a DI misconfiguration, a transient network blip, or a Prisma
  // library bug — the endpoint returns 503 instead of an unhandled
  // exception (500).  503 is the correct signal for Kubernetes:
  //   "I am unhealthy right now; stop routing traffic and wait."
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness probe — checks DB connectivity' })
  async readiness() {
    try {
      const dbHealthy = await this.health.isHealthy();

      if (!dbHealthy) {
        // 503 tells Kubernetes: remove from load-balancer, do NOT restart
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
    } catch (error) {
      // Re-throw expected ServiceUnavailableException untouched
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      // Any unexpected error (e.g. DI failure, library bug):
      // log it so it shows up in CloudWatch / kubectl logs,
      // then convert it to a 503 so probes never see a 500.
      this.logger.error(
        `Readiness check threw an unexpected error: ${(error as Error).message}`,
        (error as Error).stack,
      );

      throw new ServiceUnavailableException({
        status: 'error',
        service: 'auth-service',
        checks: { database: 'UNKNOWN' },
        timestamp: new Date().toISOString(),
      });
    }
  }
}
