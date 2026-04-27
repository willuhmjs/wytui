# Build stage
FROM node:24-alpine3.23 AS builder

# Build argument for DATABASE_URL (required for Prisma 7 generate)
ARG DATABASE_URL=postgresql://postgres:password@db:5432/wytui

WORKDIR /app

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++ gcc musl-dev linux-headers

# Copy package files
COPY wytui/package*.json ./

# Copy source code (without node_modules due to .dockerignore)
COPY wytui/ ./

# Install dependencies (after source copy to ensure no host node_modules)
RUN rm -rf node_modules && npm ci

# Rebuild bcrypt for Alpine
RUN npm rebuild bcrypt

# Generate Prisma Client with DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate

# Build the app
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Clean node_modules to reduce size
RUN find node_modules -type f \( \
    -name "*.md" -o \
    -name "*.ts" -o \
    -name "*.map" -o \
    -name "LICENSE*" -o \
    -name "CHANGELOG*" -o \
    -name "*.txt" \
    \) -delete && \
    find node_modules -type d \( \
    -name "test" -o \
    -name "tests" -o \
    -name "docs" -o \
    -name "examples" -o \
    -name ".github" \
    \) -exec rm -rf {} + 2>/dev/null || true

# Remove unused Prisma engines (keep only linux-musl-openssl-3.0.x for Alpine)
RUN find node_modules/.prisma -type f ! -name "*linux-musl-openssl-3.0.x*" -name "*.so.*" -delete 2>/dev/null || true && \
    find node_modules/@prisma -type f ! -name "*linux-musl-openssl-3.0.x*" -name "*.so.*" -delete 2>/dev/null || true

# Production stage
FROM node:24-alpine3.23

# Install runtime dependencies in one layer, clean up in same layer
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/cache/apk/* /tmp/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Create downloads directory
RUN mkdir -p /downloads && chown -R nodejs:nodejs /downloads

WORKDIR /app

# Copy built app from builder
COPY --from=builder --chown=nodejs:nodejs /app/build ./build
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/prisma.config.ts ./prisma.config.ts

# Switch to non-root user
USER nodejs

EXPOSE 3000

ENV NODE_ENV=production \
    PORT=3000

CMD ["sh", "-c", "npx prisma migrate deploy && node build"]
