-- Phase 53: a car's VIN, accounts left out of a jar's feed, the alert mailbox set in Settings, and
-- the app's service principal id kept by the Entra check.
ALTER TABLE "vehicle" ADD COLUMN "vin" TEXT;

-- NOT NULL like the repo's other lists (a Prisma list is never null; the column can't be either).
ALTER TABLE "jar_connection" ADD COLUMN "excludedExternalIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "household" ADD COLUMN "alertMailbox" TEXT;

ALTER TABLE "entra_check" ADD COLUMN "servicePrincipalId" TEXT;
