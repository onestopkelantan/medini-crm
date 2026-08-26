FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci || npm install
COPY backend/ ./
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:prod"]
