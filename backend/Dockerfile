# Development-only Dockerfile. Production hardening is a later sprint.
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]
