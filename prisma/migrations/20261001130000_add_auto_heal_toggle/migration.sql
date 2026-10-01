-- Operator switch for the automated retry of FAILED downloads
-- (heal-failed-downloads). Default true keeps the behaviour every existing
-- install already has; setting it false unregisters the job on the next
-- settings save and makes healFailedDownloads() refuse to run, leaving the
-- manual Retry button as the only way to re-queue a failed row.

-- AlterTable
ALTER TABLE "settings" ADD COLUMN "autoHealEnabled" BOOLEAN NOT NULL DEFAULT true;
