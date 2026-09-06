-- Optional path mapping for the Jellyfin automation: translate a path as seen
-- by the wytui container into the same volume as mounted by the Jellyfin
-- container (local prefix -> remote prefix).
ALTER TABLE "settings" ADD COLUMN "jellyfinLocalPath" TEXT;
ALTER TABLE "settings" ADD COLUMN "jellyfinRemotePath" TEXT;
