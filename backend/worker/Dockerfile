FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY backend/shared/package.json backend/shared/package.json
COPY backend/worker/package.json backend/worker/package.json

RUN pnpm install --filter @taxtrack/shared... --filter @taxtrack/worker...

COPY backend/shared backend/shared
COPY backend/worker backend/worker

EXPOSE 3001
CMD ["pnpm", "--filter", "@taxtrack/worker", "dev"]
