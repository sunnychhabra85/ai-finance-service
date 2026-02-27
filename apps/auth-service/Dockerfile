# =============================================================
# Production-Optimized Dockerfile (Nx + NestJS + Prisma)
# Reusable for any microservice (change SERVICE_NAME arg)
# =============================================================

############################
# 1️⃣ Dependencies Stage
############################
FROM node:20-slim AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

############################
# 2️⃣ Build Stage
############################
FROM node:20-alpine AS builder
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
RUN npx prisma generate --schema=libs/database/prisma/schema.prisma

# Build ONLY the required service (Nx handles dependency graph)
RUN npx nx build auth-service --configuration=production

############################
# 3️⃣ Production Runtime
############################
FROM node:20-alpine AS runner

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy ONLY production package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output
COPY --from=builder --chown=appuser:appgroup /app/dist/apps/auth-service ./dist

# Copy Prisma engine
COPY --from=builder --chown=appuser:appgroup /app/node_modules/.prisma ./node_modules/.prisma

USER appuser

ENV NODE_ENV=production
ENV PORT=3001
ENV PRISMA_QUERY_ENGINE_LIBRARY=/app/node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node

EXPOSE 3001

CMD ["node", "dist/main.js"]