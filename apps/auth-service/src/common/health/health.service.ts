// =============================================================
// apps/auth-service/src/common/health/health.service.ts
//
// Wraps database health check in a dedicated service.
// HealthController calls this service — controller never talks
// to DatabaseService directly (separation of concerns).
// =============================================================

import { Injectable } from '@nestjs/common';
// import { DatabaseService } from '../../../../libs/database/src/database.service';
import { DatabaseService } from '../../../../../libs/database/src/database.service';

@Injectable()
export class HealthService {
  constructor(private readonly db: DatabaseService) {}

  // Called by the readiness probe — returns true if DB is reachable
  async isHealthy(): Promise<boolean> {
    return this.db.isHealthy();
  }
}
