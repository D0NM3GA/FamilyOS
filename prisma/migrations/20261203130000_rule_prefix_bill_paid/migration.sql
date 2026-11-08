-- Phase 69c: an "always" rule for every branch, and a hand-added bill marked paid.
ALTER TABLE "category_rule" ADD COLUMN "matchPrefix" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "manual_bill" ADD COLUMN "paidDueOn" DATE;
