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
RUN apk add --no-cache ffmpeg curl python3 aria2 tini \
  && if [ "$YTDLP_VERSION" = "latest" ]; then \
  YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"; \
  else \
  YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp"; \
  fi \
  && curl -fL "$YTDLP_URL" -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && /usr/local/bin/yt-dlp --version

#yt-dlp deno
RUN apk add --no-cache \
  --repository https://dl-cdn.alpinelinux.org/alpine/edge/main \
  --repository https://dl-cdn.alpinelinux.org/alpine/edge/community \
  deno

# -G nodejs is required, not cosmetic: busybox `adduser -S` without -G does NOT
# pick the same-named group, it lands the user in nogroup (gid 65533), so the
# `chown nodejs:nodejs` below owned files by a group the process was not a member
# of and only the owner bits ever applied. Verified on node:24-alpine3.23: the
# old line gives `gid=65533(nogroup)`, this one gives `gid=1001(nodejs)`, and
# everything else (uid, home dir /home/nodejs nodejs-owned, nologin shell) is
# byte-for-byte the same, so the chowns below and the yt-dlp self-update
# staging in /usr/local/bin are unaffected.
RUN addgroup -g 1001 -S nodejs && adduser -S -D -u 1001 -G nodejs nodejs
RUN mkdir -p /downloads && chown nodejs:nodejs /downloads
# Cookie uploads write to /app/data. On Kubernetes a volume covers this path,
# but Docker named volumes only copy up ownership for paths that exist in the
# image, and /app is root-owned — without this line uploads 500 on compose.
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data

# yt-dlp self-updates in place (yt-dlp -U) from the app's scheduler, which runs
# as nodejs. It stages a temp file next to the binary and renames it over the
# original, so nodejs needs write access to both the file and its directory.
RUN chown nodejs:nodejs /usr/local/bin /usr/local/bin/yt-dlp

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

# tini as PID 1: reaps orphaned/zombie children (yt-dlp's ffmpeg dies and gets
# reparented to PID 1 after the stall watchdog kills the process group; plain
# sh/node never wait() them, so zombies accumulate for the pod's lifetime).
ENTRYPOINT ["/sbin/tini", "--"]
# Migrations are owned by the dedicated migrate containers (compose `migrate`
# service / chart `migrate` init container); the app must not run them too.
CMD ["node", "build"]
