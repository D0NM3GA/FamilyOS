-- CreateTable
CREATE TABLE "vehicle" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "currentMileage" INTEGER NOT NULL DEFAULT 0,
    "mileageUpdatedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_maintenance_item" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "intervalMiles" INTEGER,
    "intervalMonths" INTEGER,
    "lastDoneMileage" INTEGER,
    "lastDoneAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_maintenance_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_service_log" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL,
    "mileage" INTEGER NOT NULL,
    "notes" TEXT,
    "loggedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_service_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_householdId_name_key" ON "vehicle"("householdId", "name");

-- AddForeignKey
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_maintenance_item" ADD CONSTRAINT "vehicle_maintenance_item_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_service_log" ADD CONSTRAINT "vehicle_service_log_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "vehicle_maintenance_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_service_log" ADD CONSTRAINT "vehicle_service_log_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
