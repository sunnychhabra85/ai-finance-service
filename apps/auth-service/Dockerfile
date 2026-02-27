# =============================================================
# apps/auth-service/Dockerfile
# Multi-stage build — keeps final image small and secure
# Generic pattern: reuse for every NestJS service
# (change AUTH_SERVICE to the target service name)
# =============================================================

# ── Stage 1: Install dependencies ──────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy only package files first (Docker layer cache optimization)
# This layer only rebuilds when dependencies change, not on every code change
COPY package*.json ./
RUN npm ci --frozen-lockfile --ignore-scripts

# ── Stage 2: Build ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client before building
RUN npx prisma generate --schema=libs/database/prisma/schema.prisma

# Build shared libraries first (auth-service depends on them)
RUN npx nx build database --prod
RUN npx nx build shared-types --prod

# Build only the auth-service (Nx handles dependency graph)
RUN npx nx build auth-service --prod

# ── Stage 3: Production runtime ────────────────────────────────
FROM node:20-alpine AS runner

# Security: create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy entire dist folder (includes compiled libs that auth-service depends on)
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json
COPY --from=builder --chown=appuser:appgroup /app/tsconfig.json ./tsconfig.json

# Never run containers as root!
USER appuser

# Force Prisma to use the OpenSSL 3.0.x compatible binary
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node

# Document which port this service listens on
EXPOSE 3001

# Health check so Docker/K8s knows when the container is healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "-r", "tsconfig-paths/register", "dist/apps/auth-service/apps/auth-service/src/main.js"]
