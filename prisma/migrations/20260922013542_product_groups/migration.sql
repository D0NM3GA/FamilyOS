-- AlterTable
ALTER TABLE "product" ADD COLUMN     "groupId" TEXT;

-- CreateTable
CREATE TABLE "product_group" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_group_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_group_householdId_name_key" ON "product_group"("householdId", "name");

-- AddForeignKey
ALTER TABLE "product_group" ADD CONSTRAINT "product_group_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "product_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
