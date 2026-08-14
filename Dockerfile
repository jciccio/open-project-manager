# 1. Base image
FROM node:22-alpine AS base
WORKDIR /app

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

# Prisma v7 client generation and Next.js standalone build
RUN npx prisma generate
RUN yarn build

# 4. Migrator stage — runs `prisma migrate deploy` against the mounted data
#    volume. Kept separate from the runner stage (rather than bundling the
#    Prisma CLI into it) because the CLI needs the full node_modules tree —
#    schema engine, @prisma/config, effect, etc. — that the Next.js
#    standalone trace deliberately excludes to keep the runner image small.
FROM builder AS migrator
CMD ["npx", "prisma", "migrate", "deploy"]

# 5. Runner stage
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

# Set correct ownership for standalone output and static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
