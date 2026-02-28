// =============================================================
// apps/auth-service/src/auth/strategies/jwt.strategy.ts
// Validates ACCESS token on protected routes
// =============================================================
import 'reflect-metadata';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '@finance/shared-types';
import { DatabaseService } from '@finance/database';

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt-access') {
	constructor(
		private readonly db: DatabaseService,
	) {
		super({
			jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
			ignoreExpiration: false,
			secretOrKey: process.env.JWT_ACCESS_SECRET,
		});
	}

	async validate(payload: JwtPayload) {
		// Verify user still exists and is active
		const user = await this.db.user.findUnique({
			where: { id: payload.sub },
			select: { id: true, email: true, isActive: true },
		});

		if (!user || !user.isActive) {
			throw new UnauthorizedException('User not found or deactivated');
		}

		// This is attached to request.user in controllers
		return { id: user.id, email: user.email };
	}
}

