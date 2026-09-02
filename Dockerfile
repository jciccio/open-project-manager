# 1. Base image
FROM node:22-alpine AS base
WORKDIR /app

# Defined once here so the migrator and runner stages below share the same
# uid/gid — both write into the same mounted data volume.
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 2. Dependencies stage
FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# 3. Builder stage
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Ensure telemetry disabled and build environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Selects which schema `prisma generate` reads (prisma.config.ts picks
# prisma/schema.postgresql.prisma when this is postgresql/postgres, else
# prisma/schema.prisma) — the generated client's query engine is bound to
# one provider at generate time, so this must match the DATABASE_PROVIDER
# the image will actually run under. Defaults to sqlite for docker-compose.yml;
# docker-compose.postgres.yml passes DATABASE_PROVIDER=postgresql as a build arg.
ARG DATABASE_PROVIDER=sqlite
ENV DATABASE_PROVIDER=$DATABASE_PROVIDER

# Prisma v7 client generation and Next.js standalone build
RUN npx prisma generate
RUN yarn build

# 4. Migrator stage — runs `prisma migrate deploy` against the mounted data
#    volume. Kept separate from the runner stage (rather than bundling the
#    Prisma CLI into it) because the CLI needs the full node_modules tree —
#    schema engine, @prisma/config, effect, etc. — that the Next.js
#    standalone trace deliberately excludes to keep the runner image small.
#
# Runs as the same non-root `nextjs` user as the runner stage: on a fresh
# named volume, Docker seeds the volume's initial content from whichever
# image's /app/data first mounts it, and if this stage created dev.db as
# root (the default before this fix), the runner's `nextjs` user could read
# it but never write it — breaking every write, including registration.
FROM builder AS migrator
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
USER nextjs
CMD ["npx", "prisma", "migrate", "deploy"]

# 5. Runner stage
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

# Set correct ownership for standalone output and static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
