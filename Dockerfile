FROM node:24-alpine3.23 AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src ./src
COPY static ./static
COPY svelte.config.js tsconfig.json vite.config.ts ./

ARG DATABASE_URL=postgresql://postgres:password@db:5432/wytui
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate
RUN npm run build
RUN npm prune --production

FROM node:24-alpine3.23

# Defaults to the newest release so the pin cannot silently rot.
# Pin a specific version for a reproducible build or a rollback:
#   docker build --build-arg YTDLP_VERSION=2026.07.04 .
ARG YTDLP_VERSION=latest
RUN apk add --no-cache ffmpeg curl python3 aria2 \
    && if [ "$YTDLP_VERSION" = "latest" ]; then \
         YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"; \
       else \
         YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"; \
       fi \
    && curl -fL "$YTDLP_URL" -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN mkdir -p /downloads && chown nodejs:nodejs /downloads

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/build ./build
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./

USER nodejs
EXPOSE 3000
ARG GIT_SHA=unknown
ENV NODE_ENV=production PORT=3000 GIT_SHA=$GIT_SHA

CMD ["sh", "-c", "npx prisma migrate deploy && node build"]
