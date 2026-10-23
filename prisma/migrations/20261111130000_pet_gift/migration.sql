-- CreateTable
CREATE TABLE "pet_gift" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "instanceId" TEXT,
    "day" TEXT NOT NULL,
    "itemId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "pet_gift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pet_gift_instanceId_key" ON "pet_gift"("instanceId");

-- CreateIndex
CREATE INDEX "pet_gift_personId_day_idx" ON "pet_gift"("personId", "day");

-- AddForeignKey
ALTER TABLE "pet_gift" ADD CONSTRAINT "pet_gift_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_gift" ADD CONSTRAINT "pet_gift_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pet_gift" ADD CONSTRAINT "pet_gift_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "task_instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
