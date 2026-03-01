// =============================================================
// apps/auth-service/src/common/health/health.service.ts
//
// Wraps database health check in a dedicated service.
// HealthController calls this service — controller never talks
// to DatabaseService directly (separation of concerns).
//
// This service is injectable ONLY because HealthModule lists it
// in `providers`. It depends on DatabaseService which is provided
// globally via @Global() DatabaseModule — no explicit import needed
// in HealthModule, but DatabaseModule MUST be imported in AppModule.
// =============================================================

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@finance/database';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly db: DatabaseService) {}

  // Called by the readiness probe.
  // Returns true  → DB is reachable, pod is ready for traffic.
  // Returns false → DB is down, pod should be removed from LB.
  //
  // Never throws — all exceptions are caught here so the controller
  // always gets a boolean, not an unhandled rejection.
  async isHealthy(): Promise<boolean> {
    try {
      const healthy = await this.db.isHealthy();

      if (!healthy) {
        // Log explicitly so the failure shows up in CloudWatch/EKS logs.
        // The readiness probe silently returns 503; this log gives context.
        this.logger.warn('Database health check returned false — pod marked unready');
      }

      return healthy;
    } catch (error) {
      // DatabaseService.isHealthy() already has its own catch block,
      // but this outer catch is a belt-and-suspenders defence in case
      // the DB driver or Prisma itself throws synchronously.
      this.logger.error(
        `Database health check threw: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return false;
    }
  }
}
