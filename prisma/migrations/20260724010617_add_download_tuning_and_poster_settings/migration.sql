-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "concurrentFragments" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "generateJellyfinPosters" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "httpChunkSize" TEXT,
ADD COLUMN     "useAria2c" BOOLEAN NOT NULL DEFAULT false;
