-- CreateIndex
-- One subscription per (user, channel): the YouTube import matches by URL,
-- which let @handle and /channel/UC… rows for the same channel coexist.
CREATE UNIQUE INDEX "subscriptions_userId_channelId_key" ON "subscriptions"("userId", "channelId");
