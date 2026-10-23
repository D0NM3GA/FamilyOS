-- DropIndex (none needed: householdId had no index of its own, just the FK)

-- AlterTable
ALTER TABLE "shopping_list" ADD CONSTRAINT "shopping_list_householdId_key" UNIQUE ("householdId");
