-- Enable aria2c and lower concurrent downloads by default. These only change
-- the column defaults (new installs / fresh singleton rows); existing
-- installations keep whatever the admin configured.
ALTER TABLE "settings" ALTER COLUMN "maxConcurrentDownloads" SET DEFAULT 2;
ALTER TABLE "settings" ALTER COLUMN "useAria2c" SET DEFAULT true;
