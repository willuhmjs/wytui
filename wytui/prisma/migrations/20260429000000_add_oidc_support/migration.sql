-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN "authMode" TEXT NOT NULL DEFAULT 'password';
