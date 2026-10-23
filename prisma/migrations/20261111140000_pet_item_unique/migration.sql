-- Phase 47: one of each item per person. Keep the oldest of any duplicates first.
DELETE FROM "pet_item" a
USING "pet_item" b
WHERE a."personId" = b."personId"
  AND a."itemId" = b."itemId"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

-- DropIndex
DROP INDEX "pet_item_personId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "pet_item_personId_itemId_key" ON "pet_item"("personId", "itemId");
