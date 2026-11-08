-- Phase 69b: "We always have it", and "Still have some" on running low.
ALTER TABLE "product" ADD COLUMN "alwaysHave" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product" ADD COLUMN "lowSnoozedAt" TIMESTAMP(3);
