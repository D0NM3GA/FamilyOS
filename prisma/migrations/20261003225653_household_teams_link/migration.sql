/*
  Warnings:

  - You are about to drop the column `teamsWebhookEnc` on the `alert_prefs` table. All the data in the column will be lost.
  - You are about to drop the column `teamsWebhookHost` on the `alert_prefs` table. All the data in the column will be lost.
  - You are about to drop the column `teamsWebhookIv` on the `alert_prefs` table. All the data in the column will be lost.
  - You are about to drop the column `teamsWebhookTag` on the `alert_prefs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "alert_prefs" DROP COLUMN "teamsWebhookEnc",
DROP COLUMN "teamsWebhookHost",
DROP COLUMN "teamsWebhookIv",
DROP COLUMN "teamsWebhookTag";

-- CreateTable
CREATE TABLE "household_alerts" (
    "householdId" TEXT NOT NULL,
    "teamsWebhookEnc" BYTEA,
    "teamsWebhookIv" BYTEA,
    "teamsWebhookTag" BYTEA,
    "teamsWebhookHost" TEXT,
    "updatedByPersonId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_alerts_pkey" PRIMARY KEY ("householdId")
);

-- AddForeignKey
ALTER TABLE "household_alerts" ADD CONSTRAINT "household_alerts_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_alerts" ADD CONSTRAINT "household_alerts_updatedByPersonId_fkey" FOREIGN KEY ("updatedByPersonId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
