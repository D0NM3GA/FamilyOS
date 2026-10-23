-- CreateEnum
CREATE TYPE "RewardOrderStatus" AS ENUM ('WAITING_OK', 'TO_DO', 'DELIVERED', 'REFUNDED', 'DECLINED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ORDER_PLACED', 'ORDER_NEEDS_OK');

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "familyGoalStickers" INTEGER,
ADD COLUMN     "familyGoalTitle" TEXT;

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "savingRewardId" TEXT;

-- AlterTable
ALTER TABLE "points_ledger" ADD COLUMN     "orderId" TEXT;

-- AlterTable
ALTER TABLE "reward" ADD COLUMN     "bucketId" TEXT,
ADD COLUMN     "emoji" TEXT,
ADD COLUMN     "limitPerWeek" INTEGER,
ADD COLUMN     "needsApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reward_bucket" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reward_bucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reward_order" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "placedById" TEXT,
    "title" TEXT NOT NULL,
    "emoji" TEXT,
    "cost" INTEGER NOT NULL,
    "status" "RewardOrderStatus" NOT NULL,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "orderId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reward_bucket_householdId_name_key" ON "reward_bucket"("householdId", "name");

-- CreateIndex
CREATE INDEX "reward_order_householdId_status_idx" ON "reward_order"("householdId", "status");

-- CreateIndex
CREATE INDEX "reward_order_personId_rewardId_createdAt_idx" ON "reward_order"("personId", "rewardId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_recipientId_readAt_idx" ON "notification"("recipientId", "readAt");

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_savingRewardId_fkey" FOREIGN KEY ("savingRewardId") REFERENCES "reward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "reward_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward" ADD CONSTRAINT "reward_bucketId_fkey" FOREIGN KEY ("bucketId") REFERENCES "reward_bucket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_bucket" ADD CONSTRAINT "reward_bucket_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_order" ADD CONSTRAINT "reward_order_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_order" ADD CONSTRAINT "reward_order_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "reward"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_order" ADD CONSTRAINT "reward_order_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_order" ADD CONSTRAINT "reward_order_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_order" ADD CONSTRAINT "reward_order_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reward_order" ADD CONSTRAINT "reward_order_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "reward_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
