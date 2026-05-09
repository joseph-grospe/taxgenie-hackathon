FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && apk add --no-cache qpdf

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY backend/shared/package.json backend/shared/package.json
COPY backend/merge-worker/package.json backend/merge-worker/package.json

COPY backend/shared backend/shared
COPY backend/merge-worker backend/merge-worker

RUN pnpm install --filter @taxtrack/shared... --filter @taxtrack/merge-worker... --frozen-lockfile

CMD ["pnpm", "--filter", "@taxtrack/merge-worker", "dev"]
