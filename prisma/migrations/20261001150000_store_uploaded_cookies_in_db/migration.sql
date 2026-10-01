-- The uploaded cookies.txt moves into the database as crypto-box ciphertext, so it
-- survives a restart like every other credential. "cookiePath" stays (unread) so an
-- older image can still run against this database; nothing migrates from it because
-- the bytes it named were never on disk after a restart. Re-upload once.

-- AlterTable
ALTER TABLE "settings" ADD COLUMN "cookiesTxtEnc" TEXT;
ALTER TABLE "settings" ADD COLUMN "cookiesUpdatedAt" TIMESTAMP(3);
