FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm config set registry https://registry.npmmirror.com
RUN pnpm install --frozen-lockfile

ARG PACKAGE_FILTER
ARG NEXT_PUBLIC_AUTH_URL
ARG NEXT_PUBLIC_SERVICE_URL
ENV NEXT_PUBLIC_AUTH_URL=$NEXT_PUBLIC_AUTH_URL
ENV NEXT_PUBLIC_SERVICE_URL=$NEXT_PUBLIC_SERVICE_URL

RUN pnpm --filter @mediaforge/contracts build
RUN pnpm --filter "$PACKAGE_FILTER" build

ENV NODE_ENV=production

CMD ["node", "--version"]
