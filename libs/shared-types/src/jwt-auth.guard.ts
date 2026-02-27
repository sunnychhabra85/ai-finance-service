// =============================================================
// libs/shared-types/src/jwt-auth.guard.ts
// Shared JWT guard — used by upload, analytics, notification services
// All services validate the SAME JWT_ACCESS_SECRET issued by auth-service
// =============================================================

import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

// ── Re-usable strategy factory ─────────────────────────────────
// Pass the config key where JWT secret is stored (differs per service)
export function createJwtStrategy(secretConfigKey: string) {
  @Injectable()
  class JwtStrategyImpl extends PassportStrategy(Strategy, 'jwt') {
    constructor(config: ConfigService, public readonly prisma: PrismaClient) {
      super({
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        ignoreExpiration: false,
        secretOrKey: config.get<string>(secretConfigKey),
      });
    }

    async validate(payload: { sub: string; email: string }) {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, isActive: true },
      });
      if (!user || !user.isActive) {
        throw new UnauthorizedException('User not found or deactivated');
      }
      return { id: user.id, email: user.email };
    }
  }
  return JwtStrategyImpl;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest(err: any, user: any) {
    if (err || !user) throw new UnauthorizedException('Invalid or expired token');
    return user;
  }
}
