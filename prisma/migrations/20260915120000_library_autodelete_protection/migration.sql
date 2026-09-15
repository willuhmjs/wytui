-- AlterTable
ALTER TABLE "downloads" ADD COLUMN "protected" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN "autoDeleteLibraryDays" INTEGER;

-- AlterTable
ALTER TABLE "channel_overrides" ADD COLUMN "protected" BOOLEAN NOT NULL DEFAULT false;
