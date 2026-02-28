// =============================================================
// apps/auth-service/src/common/health/health.module.ts
// Kubernetes uses /health for liveness/readiness probes
// =============================================================

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
