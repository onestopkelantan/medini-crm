# Medini AI Dental CRM — full-stack (frontend build + tRPC/Hono server)
FROM node:20-slim
WORKDIR /app

# Build tools so native modules (better-sqlite3) compile even when prebuilt
# binaries cannot be downloaded during the image build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install all dependencies (dev included — needed for vite build & esbuild)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy source and build (vite → dist/public, esbuild → dist/boot.js)
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
