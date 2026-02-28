// =============================================================
// apps/auth-service/src/auth/strategies/jwt-refresh.strategy.ts
// Validates REFRESH token on the /refresh endpoint
// =============================================================

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import * as crypto from 'crypto';
import { JwtPayload } from '@finance/shared-types';
import { DatabaseService } from '@finance/database';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly db: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromBodyField('refreshToken'),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_REFRESH_SECRET,
      passReqToCallback: true, // Pass full request to validate()
    });
  }

  async validate(req: Request, payload: JwtPayload) {
    const rawToken = req.body?.refreshToken;

    // Hash the incoming refresh token and check against DB
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const storedToken = await this.db.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!storedToken || storedToken.isRevoked) {
      throw new UnauthorizedException('Invalid or revoked refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    return { id: payload.sub, email: payload.email, tokenHash };
  }
}
