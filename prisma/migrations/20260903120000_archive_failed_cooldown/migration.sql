-- Track when a download terminally failed so subscription sync can apply a
-- re-queue cooldown instead of immediately re-enqueueing the same video.
ALTER TABLE "archive" ADD COLUMN "failedAt" TIMESTAMP(3);
