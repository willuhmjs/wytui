-- Per-subscription max video length filter (null = no limit)
ALTER TABLE "subscriptions" ADD COLUMN "maxDurationSeconds" INTEGER;
