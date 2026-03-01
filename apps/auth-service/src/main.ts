// =============================================================
// apps/auth-service/src/main.ts
// Entry point for the Auth Service
// =============================================================

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('AuthService');
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // Ensure SIGTERM/SIGINT from Kubernetes trigger graceful shutdown
  app.enableShutdownHooks();

  // ── Global prefix ───────────────────────────────────────────
  // All routes: /api/v1/auth/...
  app.setGlobalPrefix('api/v1');

  // ── Validation ─────────────────────────────────────────────
  // Automatically validates all incoming DTOs using class-validator
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,        // Strip unknown properties
      forbidNonWhitelisted: true, // Throw error on unknown properties
      transform: true,        // Auto-transform types (string → number etc.)
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── CORS ────────────────────────────────────────────────────
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  });

  // ── Swagger (non-production only) ──────────────────────────────────
  // Wrapped in try/catch so a Swagger metadata error (e.g. a controller
  // parameter missing type metadata) can NEVER crash the process.
  // The app must always start; probes must always be reachable.
  if (process.env.NODE_ENV !== 'production') {
    try {
      const config = new DocumentBuilder()
        .setTitle('Auth Service API')
        .setDescription('Authentication & Authorization endpoints')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api/docs', app, document);
      logger.log('Swagger available at /api/docs');
    } catch (swaggerError) {
      // Log clearly so the developer sees it immediately, then continue
      // booting.  Health probes still respond; the service still works.
      logger.warn(
        `Swagger init failed — docs will be unavailable: ${
          (swaggerError as Error).message
        }`,
      );
    }
  }

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`Auth Service running on port ${port}`);
}

bootstrap();
