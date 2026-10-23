-- AlterTable
ALTER TABLE "mail_order" ADD COLUMN     "giftById" TEXT,
ADD COLUMN     "giftHiddenFrom" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "giftRevealOn" DATE;
