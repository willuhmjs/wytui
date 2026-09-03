-- Subscriptions: shorts exclusion toggle, cached channel ID for RSS checks,
-- and last-check error for observability.
ALTER TABLE "subscriptions" ADD COLUMN "excludeShorts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD COLUMN "channelId" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "lastError" TEXT;

-- Archive: mark deliberately skipped videos (e.g. excluded shorts) so the
-- "seeded archive entry" healing logic never re-queues them.
ALTER TABLE "archive" ADD COLUMN "reason" TEXT;
