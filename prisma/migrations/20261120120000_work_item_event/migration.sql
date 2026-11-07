-- CreateEnum
CREATE TYPE "WorkItemType" AS ENUM ('CHORE', 'ASSIGNMENT', 'SCHOOL_TASK');

-- CreateTable
CREATE TABLE "work_item_event" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "itemType" "WorkItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_item_event_itemType_itemId_createdAt_idx" ON "work_item_event"("itemType", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "work_item_event_householdId_createdAt_idx" ON "work_item_event"("householdId", "createdAt");

-- AddForeignKey
ALTER TABLE "work_item_event" ADD CONSTRAINT "work_item_event_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_event" ADD CONSTRAINT "work_item_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
