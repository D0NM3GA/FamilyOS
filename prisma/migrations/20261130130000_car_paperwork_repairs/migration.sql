-- Phase 65b: car paperwork and one-off repairs.
CREATE TYPE "VehicleItemKind" AS ENUM ('SERVICE', 'PAPERWORK', 'REPAIRS');
ALTER TABLE "vehicle_maintenance_item" ADD COLUMN "kind" "VehicleItemKind" NOT NULL DEFAULT 'SERVICE', ADD COLUMN "nextDueAt" TIMESTAMP(3);
ALTER TABLE "vehicle_service_log" ADD COLUMN "title" TEXT;
