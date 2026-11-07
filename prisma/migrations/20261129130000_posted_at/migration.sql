-- Phase 64d: when a feed hold posted on its own row.
ALTER TABLE "fin_transaction" ADD COLUMN "postedAt" TIMESTAMP(3);
