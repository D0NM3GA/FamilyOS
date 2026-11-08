-- Phase 68a: a reminder when a dose is due (opt-in), and a course of medicine's last day.
ALTER TYPE "NotificationKind" ADD VALUE 'REMINDER_DOSE_DUE';
ALTER TABLE "reminder_prefs" ADD COLUMN "optIn" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "task_definition" ADD COLUMN "endDate" TIMESTAMP(3);
