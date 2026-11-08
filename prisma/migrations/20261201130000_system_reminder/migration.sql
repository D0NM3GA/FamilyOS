-- Phase 67b: admins hear when a background job or the nightly backup stops.
ALTER TYPE "NotificationKind" ADD VALUE 'REMINDER_SYSTEM';
