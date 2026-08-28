FROM node:20-alpine
WORKDIR /app

# native build deps (argon2, msgpackr)
RUN apk add --no-cache python3 make g++

# install dependencies
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# copy source and build
COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:prod"]

# trigger deploy 2026-08-28 15:32:17

# trigger deploy 2026-08-28 15:43:00
