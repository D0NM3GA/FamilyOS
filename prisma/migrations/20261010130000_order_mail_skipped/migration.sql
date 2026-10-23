-- AlterTable
ALTER TABLE "mail_order_scan" ADD COLUMN     "skippedHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
