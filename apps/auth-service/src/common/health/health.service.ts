import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@finance/database';

@Injectable()
export class HealthService {
  constructor(private readonly db: DatabaseService) {}

  async liveness() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  async readiness() {
    const dbHealthy = await this.db.isHealthy();

    return {
      status: dbHealthy ? 'ready' : 'not_ready',
      database: dbHealthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }

  // Convenience method if a boolean is needed
  async isHealthy(): Promise<boolean> {
    return this.db.isHealthy();
  }
}