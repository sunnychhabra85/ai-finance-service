// =============================================================
// apps/auth-service/src/common/health/health.module.ts
//
// ROOT CAUSE OF THE BUG:
//   The old version of this file did NOT list HealthService in `providers`.
//   NestJS dependency injection couldn't find it, so `this.health` in
//   HealthController was undefined at runtime → crash on /health/ready.
//
// THE FIX: add `providers: [HealthService]` below.
// =============================================================

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],   // ← THE FIX: was missing entirely in the old file
  exports: [HealthService],
})
export class HealthModule {}
