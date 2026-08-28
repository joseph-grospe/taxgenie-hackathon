FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
RUN apk add --no-cache poppler-utils

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY backend/shared/package.json backend/shared/package.json
COPY backend/worker/package.json backend/worker/package.json

COPY backend/shared backend/shared
COPY backend/worker backend/worker

RUN pnpm install --filter @taxgenie/shared... --filter @taxgenie/worker... --frozen-lockfile

EXPOSE 3001
CMD ["pnpm", "--filter", "@taxgenie/worker", "dev"]
