-- CreateTable
CREATE TABLE "alert_prefs" (
    "personId" TEXT NOT NULL,
    "teamsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "teamsWebhookEnc" BYTEA,
    "teamsWebhookIv" BYTEA,
    "teamsWebhookTag" BYTEA,
    "teamsWebhookHost" TEXT,
    "lastErrorTeams" TEXT,
    "lastErrorEmail" TEXT,
    "lastSentTeams" TIMESTAMP(3),
    "lastSentEmail" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_prefs_pkey" PRIMARY KEY ("personId")
);

-- AddForeignKey
ALTER TABLE "alert_prefs" ADD CONSTRAINT "alert_prefs_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
