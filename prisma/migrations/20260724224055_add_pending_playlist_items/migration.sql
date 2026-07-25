-- AlterTable
ALTER TABLE "playlist_items" ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "thumbnail" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "videoId" TEXT,
ALTER COLUMN "downloadId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "playlist_items_playlistId_videoId_idx" ON "playlist_items"("playlistId", "videoId");
