-- Phase 50: Teams through the family's own Teams app (a bot) instead of a Workflows link.
ALTER TABLE "household_alerts"
  DROP COLUMN "teamsWebhookEnc",
  DROP COLUMN "teamsWebhookIv",
  DROP COLUMN "teamsWebhookTag",
  DROP COLUMN "teamsWebhookHost",
  ADD COLUMN "teamsManifestId" TEXT,
  ADD COLUMN "teamsAppId" TEXT,
  ADD COLUMN "teamsAppVersion" TEXT,
  ADD COLUMN "teamsAppHash" TEXT,
  ADD COLUMN "teamsPublishedAt" TIMESTAMP(3);

ALTER TABLE "alert_prefs"
  ADD COLUMN "teamsInstallId" TEXT,
  ADD COLUMN "teamsChatId" TEXT;

ALTER TABLE "money_jar" ADD COLUMN "teamsChatName" TEXT;
