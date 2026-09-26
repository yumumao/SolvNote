# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
# OpenSSL is needed when Prisma resolves the native engine, not just at runtime.
RUN apk add --no-cache libc6-compat openssl
ENV NEXT_TELEMETRY_DISABLED=1

# Every stage uses the TARGET platform. Never install native dependencies on
# BUILDPLATFORM and copy them into an image for a different architecture.
FROM base AS deps
ARG TARGETARCH
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=solvnote-npm-${TARGETARCH},target=/root/.npm \
    npm ci --no-audit --no-fund

FROM base AS builder
ARG TARGETARCH
COPY --from=deps /app/node_modules ./node_modules
# Generate the client in a schema-only layer; source edits do not invalidate it.
# `native` in binaryTargets resolves to this image's architecture, including ARM.
COPY prisma/schema.prisma ./prisma/schema.prisma
ENV DATABASE_URL="file:/app/data/dev.db"
RUN ./node_modules/.bin/prisma generate
COPY . .

# Compile the runtime tag initializer, but do not execute it or seed a database.
# Static page generation needs the client types, not a populated database.
RUN ./node_modules/.bin/tsc scripts/rebuild-system-tags.ts --outDir dist-scripts --esModuleInterop --resolveJsonModule --skipLibCheck --module commonjs --target ES2020
# Build-only setting: it must never become an ENV in the runtime image.
RUN --mount=type=cache,id=solvnote-next-${TARGETARCH},target=/app/.next/cache \
    AI_WORKER_DISABLED=1 npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN apk add --no-cache su-exec \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && mkdir -p /app/data /app/config \
    && chown -R nextjs:nodejs /app/data /app/config

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Keep the Prisma CLI and same-platform engines for runtime migrations.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
# The bootstrap is CommonJS; Next traces the ESM bcrypt entry and can omit umd/.
# Ship both entrypoints rather than relying on web-route tracing for CLI scripts.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs
# Copy schema/migrations explicitly; never bake a development DB or config in.
COPY --from=builder --chown=nextjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma/migrations ./prisma/migrations
COPY --from=builder --chown=nextjs:nodejs /app/dist-scripts ./dist-scripts
COPY --from=builder --chown=nextjs:nodejs /app/scripts/seed-admin.js ./dist-scripts/scripts/seed-admin.js
# Load real runtime imports without invoking main() or opening a database.
RUN node -e "require('./dist-scripts/scripts/seed-admin.js'); console.log('Bootstrap runtime imports verified')"


COPY --chown=nextjs:nodejs --chmod=755 docker-entrypoint.sh ./
COPY --chown=nextjs:nodejs https-server.js ./

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/data/dev.db"
ENV AUTH_TRUST_HOST=true

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
