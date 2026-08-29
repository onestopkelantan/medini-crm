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

# trigger deploy 2026-08-28 15:45:28

# trigger deploy booking 20:36:22

# trigger deploy booking-api 10:38:12

# trigger deploy wa-payload-log 11:25:43

# trigger deploy real-phone 11:44:31

# trigger deploy booking-notify 13:03:17

# trigger deploy setia-branch 14:42:43
