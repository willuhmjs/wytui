-- CreateTable
CREATE TABLE "youtube_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cookiesEnc" TEXT NOT NULL,
    "cookieUpdatedAt" TIMESTAMP(3) NOT NULL,
    "channelName" TEXT,
    "channelHandle" TEXT,
    "channelId" TEXT,
    "syncWatchedToYouTube" BOOLEAN NOT NULL DEFAULT false,
    "syncHistoryToWytui" BOOLEAN NOT NULL DEFAULT false,
    "syncWatchLater" BOOLEAN NOT NULL DEFAULT false,
    "useFeedForNewVideos" BOOLEAN NOT NULL DEFAULT false,
    "lastFeedCheck" TIMESTAMP(3),
    "lastHistorySync" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "youtube_links_userId_key" ON "youtube_links"("userId");

-- AddForeignKey
ALTER TABLE "youtube_links" ADD CONSTRAINT "youtube_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
