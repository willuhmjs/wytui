-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('PENDING', 'FETCHING_INFO', 'DOWNLOADING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionType" AS ENUM ('CHANNEL', 'PLAYLIST', 'USER');

-- CreateEnum
CREATE TYPE "MonitorType" AS ENUM ('YOUTUBE_LIVE', 'TWITCH');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "download_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "format" TEXT,
    "quality" TEXT,
    "codec" TEXT,
    "audioOnly" BOOLEAN NOT NULL DEFAULT false,
    "audioFormat" TEXT,
    "audioBitrate" TEXT,
    "customFlags" TEXT[],
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "downloads" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "DownloadStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT,
    "thumbnail" TEXT,
    "duration" INTEGER,
    "uploader" TEXT,
    "uploadDate" TIMESTAMP(3),
    "format" TEXT,
    "filesize" BIGINT,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "speed" TEXT,
    "eta" TEXT,
    "downloadedBytes" BIGINT DEFAULT 0,
    "totalBytes" BIGINT,
    "filename" TEXT,
    "filepath" TEXT,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "profileId" TEXT NOT NULL,
    "userId" TEXT,
    "subscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SubscriptionType" NOT NULL DEFAULT 'CHANNEL',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInterval" INTEGER NOT NULL DEFAULT 1800,
    "lastChecked" TIMESTAMP(3),
    "lastVideoDate" TIMESTAMP(3),
    "profileId" TEXT NOT NULL,
    "autoDownload" BOOLEAN NOT NULL DEFAULT true,
    "maxVideos" INTEGER,
    "thumbnail" TEXT,
    "description" TEXT,
    "videoCount" INTEGER,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MonitorType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "lastChecked" TIMESTAMP(3),
    "waitTime" INTEGER,
    "liveDate" TIMESTAMP(3),
    "profileId" TEXT NOT NULL,
    "autoDownload" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "maxConcurrentDownloads" INTEGER NOT NULL DEFAULT 3,
    "downloadPath" TEXT NOT NULL DEFAULT '/downloads',
    "ytdlpPath" TEXT NOT NULL DEFAULT '/usr/local/bin/yt-dlp',
    "ytdlpVersion" TEXT,
    "lastYtdlpUpdate" TIMESTAMP(3),
    "autoUpdateYtdlp" BOOLEAN NOT NULL DEFAULT true,
    "updateCheckInterval" INTEGER NOT NULL DEFAULT 86400,
    "enableArchive" BOOLEAN NOT NULL DEFAULT true,
    "archivePath" TEXT,
    "autoDeleteAfter" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "download_profiles_userId_name_key" ON "download_profiles"("userId", "name");

-- CreateIndex
CREATE INDEX "downloads_status_idx" ON "downloads"("status");

-- CreateIndex
CREATE INDEX "downloads_userId_idx" ON "downloads"("userId");

-- CreateIndex
CREATE INDEX "downloads_subscriptionId_idx" ON "downloads"("subscriptionId");

-- CreateIndex
CREATE INDEX "downloads_createdAt_idx" ON "downloads"("createdAt");

-- CreateIndex
CREATE INDEX "subscriptions_enabled_idx" ON "subscriptions"("enabled");

-- CreateIndex
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "monitors_url_key" ON "monitors"("url");

-- CreateIndex
CREATE INDEX "monitors_enabled_idx" ON "monitors"("enabled");

-- CreateIndex
CREATE INDEX "monitors_isLive_idx" ON "monitors"("isLive");

-- CreateIndex
CREATE UNIQUE INDEX "archive_videoId_key" ON "archive"("videoId");

-- CreateIndex
CREATE INDEX "archive_videoId_idx" ON "archive"("videoId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_profiles" ADD CONSTRAINT "download_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "download_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "downloads" ADD CONSTRAINT "downloads_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "download_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "download_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

