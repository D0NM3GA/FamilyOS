-- Phase 53: "left out of this jar" moves from the bank connection to the account itself, so a
-- backup carries it (connections aren't in backups) and a restore can still bring it back.
ALTER TABLE "fin_account" ADD COLUMN "leftOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "jar_connection" DROP COLUMN "excludedExternalIds";
