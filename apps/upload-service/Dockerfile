# =============================================================
# apps/upload-service/Dockerfile
# Multi-stage build — identical pattern to auth-service
# Only the target name changes: upload-service
# =============================================================

# ── Stage 1: Install dependencies ──────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --frozen-lockfile

# ── Stage 2: Build ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate --schema=libs/database/prisma/schema.prisma

# Build shared libraries first (upload-service depends on them)
RUN npx nx build database --prod
RUN npx nx build shared-types --prod

# Build upload-service only
RUN npx nx build upload-service --prod

# ── Stage 3: Production runtime ────────────────────────────────
FROM node:20-alpine AS runner

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3002/api/v1/health || exit 1

ENV NODE_ENV=production
ENV PORT=3002
ENV SERVICE_NAME=upload-service

CMD ["node", "-r", "tsconfig-paths/register", "dist/apps/upload-service/apps/upload-service/src/main.js"]
