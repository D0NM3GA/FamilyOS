-- CreateTable
CREATE TABLE "vehicle_supply" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partNumber" TEXT,
    "unit" TEXT,
    "quantityOnHand" DOUBLE PRECISION,
    "lowThreshold" DOUBLE PRECISION,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_supply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_item_supply" (
    "itemId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "vehicle_item_supply_pkey" PRIMARY KEY ("itemId","supplyId")
);

-- CreateTable
CREATE TABLE "vehicle_service_supply_use" (
    "logId" TEXT NOT NULL,
    "supplyId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "vehicle_service_supply_use_pkey" PRIMARY KEY ("logId","supplyId")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_supply_householdId_name_key" ON "vehicle_supply"("householdId", "name");

-- AddForeignKey
ALTER TABLE "vehicle_supply" ADD CONSTRAINT "vehicle_supply_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_item_supply" ADD CONSTRAINT "vehicle_item_supply_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "vehicle_maintenance_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_item_supply" ADD CONSTRAINT "vehicle_item_supply_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "vehicle_supply"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_service_supply_use" ADD CONSTRAINT "vehicle_service_supply_use_logId_fkey" FOREIGN KEY ("logId") REFERENCES "vehicle_service_log"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_service_supply_use" ADD CONSTRAINT "vehicle_service_supply_use_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "vehicle_supply"("id") ON DELETE CASCADE ON UPDATE CASCADE;
