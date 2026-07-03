FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS backend-build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN DATABASE_URL=postgresql://app:app@postgres:5432/image_feed npm run prisma:generate

COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/package*.json ./
COPY --from=backend-build /app/prisma ./prisma
COPY --from=backend-build /app/prisma.config.ts ./prisma.config.ts
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public

USER node

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
