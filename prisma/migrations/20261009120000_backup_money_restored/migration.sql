-- AlterTable
ALTER TABLE "backup_event" ADD COLUMN     "moneyRestored" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "restoredJarCount" INTEGER NOT NULL DEFAULT 0;
