-- Phase 40.2c: notices about sign-in changes (lib/sign-in-notices.ts), and the switch for the
-- ones about other people.
-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'SIGN_IN_CHANGED';

-- AlterTable
ALTER TABLE "alert_prefs" ADD COLUMN     "signInNotices" BOOLEAN NOT NULL DEFAULT true;

