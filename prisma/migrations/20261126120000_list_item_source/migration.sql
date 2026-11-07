-- AlterTable
ALTER TABLE "shopping_list_item" ADD COLUMN     "medicationId" TEXT,
ADD COLUMN     "vehicleSupplyId" TEXT;

-- AddForeignKey
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_vehicleSupplyId_fkey" FOREIGN KEY ("vehicleSupplyId") REFERENCES "vehicle_supply"("id") ON DELETE SET NULL ON UPDATE CASCADE;

