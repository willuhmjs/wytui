-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "ytdlpExtraFlags" DROP DEFAULT;

-- AlterTable
ALTER TABLE "youtube_links" ALTER COLUMN "extraFlags" DROP DEFAULT;

-- CreateTable
CREATE TABLE "job_queue" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_queue_status_runAt_idx" ON "job_queue"("status", "runAt");

-- CreateIndex
CREATE INDEX "job_queue_type_idx" ON "job_queue"("type");
