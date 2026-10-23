-- AlterTable
ALTER TABLE "vehicle_service_log" ADD COLUMN     "costCents" INTEGER;

-- CreateTable
CREATE TABLE "vehicle_fuel_log" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "mileage" INTEGER NOT NULL,
    "gallons" DOUBLE PRECISION NOT NULL,
    "costCents" INTEGER,
    "fullTank" BOOLEAN NOT NULL DEFAULT true,
    "missedPrevious" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "loggedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_fuel_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_recall_ack" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "campaignNumber" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedById" TEXT,

    CONSTRAINT "vehicle_recall_ack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_fuel_log_vehicleId_filledAt_idx" ON "vehicle_fuel_log"("vehicleId", "filledAt");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_recall_ack_vehicleId_campaignNumber_key" ON "vehicle_recall_ack"("vehicleId", "campaignNumber");

-- AddForeignKey
ALTER TABLE "vehicle_fuel_log" ADD CONSTRAINT "vehicle_fuel_log_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_fuel_log" ADD CONSTRAINT "vehicle_fuel_log_loggedById_fkey" FOREIGN KEY ("loggedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_recall_ack" ADD CONSTRAINT "vehicle_recall_ack_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_recall_ack" ADD CONSTRAINT "vehicle_recall_ack_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
