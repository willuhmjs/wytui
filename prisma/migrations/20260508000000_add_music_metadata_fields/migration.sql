-- AlterTable
ALTER TABLE "downloads" ADD COLUMN "artist" TEXT;
ALTER TABLE "downloads" ADD COLUMN "album" TEXT;
ALTER TABLE "downloads" ADD COLUMN "trackNumber" INTEGER;
ALTER TABLE "downloads" ADD COLUMN "releaseYear" INTEGER;
ALTER TABLE "downloads" ADD COLUMN "musicBrainzId" TEXT;
