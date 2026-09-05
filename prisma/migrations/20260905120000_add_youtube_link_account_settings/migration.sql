-- AlterTable
ALTER TABLE "youtube_links" ADD COLUMN "proxyUrl" TEXT;
ALTER TABLE "youtube_links" ADD COLUMN "extraFlags" TEXT[] DEFAULT ARRAY[]::text[];
ALTER TABLE "youtube_links" ADD COLUMN "appriseUrl" TEXT;
ALTER TABLE "youtube_links" ADD COLUMN "notifyOnComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "youtube_links" ADD COLUMN "notifyOnFail" BOOLEAN NOT NULL DEFAULT false;
