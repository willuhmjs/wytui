# Build stage
FROM node:24-alpine3.23 AS builder

# Build argument for DATABASE_URL (required for Prisma 7 generate)
ARG DATABASE_URL=postgresql://postgres:password@db:5432/wytui

WORKDIR /app

# Copy package files
COPY wytui/package*.json ./
RUN npm ci

# Copy source code
COPY wytui/ ./

# Generate Prisma Client with DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL
RUN npx prisma generate

# Build the app
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Production stage
FROM node:24-alpine3.23

# Install runtime dependencies
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/cache/apk/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

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
