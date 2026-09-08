-- Jellyfin user whose Played state a linked account's watch history is
-- pushed to (see YouTubeLink.syncHistoryToWytui).
ALTER TABLE "youtube_links" ADD COLUMN "jellyfinUserId" TEXT;
