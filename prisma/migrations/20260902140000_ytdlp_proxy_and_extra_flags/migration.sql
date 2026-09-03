-- Global yt-dlp defaults: outbound proxy (SOCKS/HTTP) and extra default flags
-- applied to every yt-dlp invocation.
ALTER TABLE "settings" ADD COLUMN "ytdlpProxyUrl" TEXT;
ALTER TABLE "settings" ADD COLUMN "ytdlpExtraFlags" TEXT[] DEFAULT ARRAY[]::text[];
