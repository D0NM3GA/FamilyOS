-- Phase 70c: a grown-up's check before stickers, and kids swapping chores.
-- CreateEnum
CREATE TYPE "ChoreSwapStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'LAPSED');

-- AlterTable
ALTER TABLE "task_definition" ADD COLUMN     "needsCheck" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "task_instance" ADD COLUMN     "awaitingCheck" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "chore_swap" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "giveBackId" TEXT,
    "giveBackDueDate" TIMESTAMP(3),
    "status" "ChoreSwapStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "chore_swap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chore_swap_toId_status_idx" ON "chore_swap"("toId", "status");

-- CreateIndex
CREATE INDEX "chore_swap_fromId_status_idx" ON "chore_swap"("fromId", "status");

-- CreateIndex
CREATE INDEX "chore_swap_instanceId_idx" ON "chore_swap"("instanceId");

-- AddForeignKey
ALTER TABLE "chore_swap" ADD CONSTRAINT "chore_swap_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chore_swap" ADD CONSTRAINT "chore_swap_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "task_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chore_swap" ADD CONSTRAINT "chore_swap_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chore_swap" ADD CONSTRAINT "chore_swap_toId_fkey" FOREIGN KEY ("toId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chore_swap" ADD CONSTRAINT "chore_swap_giveBackId_fkey" FOREIGN KEY ("giveBackId") REFERENCES "task_instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

