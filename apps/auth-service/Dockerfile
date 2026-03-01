# ---------- deps ----------
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---------- builder ----------
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate --schema=libs/database/prisma/schema.prisma

# Build database lib
RUN npx nx build database --prod

# Build auth service
RUN npx nx build auth-service --prod

# ---------- runner ----------
FROM node:20-slim AS runner

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1001 appgroup && useradd -u 1001 -g appgroup -s /usr/sbin/nologin -m appuser

WORKDIR /app

# Use --chown on every COPY so ownership is set atomically by Docker,
# avoiding a separate `RUN chown -R` that iterates all of node_modules
# (tens of thousands of inodes) and can take 5+ minutes.
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/libs/database/prisma ./libs/database/prisma

# tsconfig-paths/register (a devDependency already in node_modules)
# reads this file at startup to resolve @finance/* aliases to
# dist/libs/*/src at runtime — replacing what tsup's bundler used to do.
COPY --from=builder --chown=appuser:appgroup /app/tsconfig.production.json ./tsconfig.json

USER appuser

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

# -r tsconfig-paths/register  →  resolves @finance/* aliases at runtime
# The tsc build puts main.js at dist/apps/auth-service/src/main.js
# (rootDir=workspace root, outDir=dist, so path mirrors the source tree)
CMD ["node", "-r", "tsconfig-paths/register", "dist/apps/auth-service/src/main.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1