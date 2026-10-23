-- DropForeignKey
ALTER TABLE "reward_order" DROP CONSTRAINT "reward_order_rewardId_fkey";

-- AddForeignKey
ALTER TABLE "reward_order" ADD CONSTRAINT "reward_order_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "reward"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
