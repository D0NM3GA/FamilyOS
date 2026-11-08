-- Phase 65a: as-needed medicines.
ALTER TYPE "FrequencyType" ADD VALUE 'AS_NEEDED';
ALTER TABLE "medication" ADD COLUMN "minGapHours" DOUBLE PRECISION, ADD COLUMN "maxPerDay" INTEGER;
