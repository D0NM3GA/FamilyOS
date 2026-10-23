-- Phase 23: kid picks (vetoable) and the "not this time" ping. The enum value isn't used in
-- this migration (Postgres can't use a value added in the same transaction).
-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'GROCERY_NOT_THIS_TIME';

-- AlterTable
ALTER TABLE "purchase_item" ADD COLUMN     "kidPick" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "shopping_list_item" ADD COLUMN     "kidPick" BOOLEAN NOT NULL DEFAULT false;

