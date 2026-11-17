# Self-hosted Sophie web app (Next.js standalone). Build: docker build -t sophie-web .
FROM node:24-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production
RUN pnpm exec next build

FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next-build/standalone ./
COPY --from=build /app/.next-build/static ./.next-build/static
COPY --from=build /app/public ./public
# Migration SQL kept for manual `tsx lib/db/migrate` runs.
COPY --from=build /app/lib/db/migrations ./lib/db/migrations
EXPOSE 3000
CMD ["node", "server.js"]
