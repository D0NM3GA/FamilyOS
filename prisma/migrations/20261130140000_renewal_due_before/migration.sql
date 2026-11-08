-- Phase 65b: a paperwork renewal remembers the due day before it, for undo.
ALTER TABLE "vehicle_service_log" ADD COLUMN "dueAtBefore" TIMESTAMP(3);
