-- Auto-heal pacing for FAILED downloads: when a row is due for an automated
-- re-attempt (nextHealAt) and how many attempts it has already spent
-- (healAttempts). retryCount stays untouched — it counts the in-process
-- 1s/2s/4s quick retries, a different budget entirely.

-- AlterTable
ALTER TABLE "downloads" ADD COLUMN "healAttempts" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "downloads" ADD COLUMN "nextHealAt" TIMESTAMP(3);
