/*
  Warnings:

  - A unique constraint covering the columns `[username]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "oidcClientId" TEXT,
ADD COLUMN     "oidcClientSecret" TEXT,
ADD COLUMN     "oidcDisplayName" TEXT,
ADD COLUMN     "oidcEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "oidcIssuerUrl" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
