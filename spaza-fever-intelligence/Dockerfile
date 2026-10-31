FROM node:20-bookworm-slim

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3001 5173
CMD ["pnpm", "dev"]
