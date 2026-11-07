-- AlterTable
ALTER TABLE "vehicle" ADD COLUMN     "recallsBaselinedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "vehicle_recall_seen" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "campaignNumber" TEXT NOT NULL,
    "component" TEXT NOT NULL DEFAULT '',
    "parkIt" BOOLEAN NOT NULL DEFAULT false,
    "baseline" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_recall_seen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_recall_seen_vehicleId_baseline_firstSeenAt_idx" ON "vehicle_recall_seen"("vehicleId", "baseline", "firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_recall_seen_vehicleId_campaignNumber_key" ON "vehicle_recall_seen"("vehicleId", "campaignNumber");

-- AddForeignKey
ALTER TABLE "vehicle_recall_seen" ADD CONSTRAINT "vehicle_recall_seen_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

