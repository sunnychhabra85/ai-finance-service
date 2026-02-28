# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---------- builder ----------
FROM node:20-alpine AS builder
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
FROM node:20-alpine AS runner

RUN apk add --no-cache wget
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/libs/database/prisma ./libs/database/prisma

# Prisma generate again for production image
RUN npx prisma generate --schema=libs/database/prisma/schema.prisma

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "dist/apps/auth-service/apps/auth-service/src/main.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1