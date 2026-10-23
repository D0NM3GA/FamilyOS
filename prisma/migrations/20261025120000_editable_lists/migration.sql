-- Phase 37: editable store sections and money categories. A section remembers which starting
-- section it is, so a new item's guessed section survives a rename; a category remembers the
-- keys of categories removed into it; a jar's history records added, renamed and removed
-- categories.

-- AlterEnum
ALTER TYPE "JarEventKind" ADD VALUE 'CATEGORY_ADDED';
ALTER TYPE "JarEventKind" ADD VALUE 'CATEGORY_RENAMED';
ALTER TYPE "JarEventKind" ADD VALUE 'CATEGORY_REMOVED';

-- AlterTable
ALTER TABLE "fin_category" ADD COLUMN     "absorbedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "product_group" ADD COLUMN     "starterKey" TEXT;

-- Backfill: a section still named as it started (lib/groceries/sections.ts STARTING_SECTIONS,
-- ignoring case) is that starting section. One section per household gets each key: the
-- first in walking order, should two differ only in case.
UPDATE "product_group" AS g
SET "starterKey" = s.key
FROM (
  VALUES
    ('produce', 'Produce'),
    ('dairy', 'Dairy'),
    ('meat', 'Meat'),
    ('bakery', 'Bakery'),
    ('pantry', 'Pantry'),
    ('frozen', 'Frozen'),
    ('snacks', 'Snacks'),
    ('drinks', 'Drinks'),
    ('household', 'Household'),
    ('bath', 'Bath & body'),
    ('pet', 'Pet'),
    ('baby', 'Baby')
) AS s(key, name)
WHERE g."id" = (
  SELECT g2."id" FROM "product_group" AS g2
  WHERE g2."householdId" = g."householdId" AND lower(g2."name") = lower(s.name)
  ORDER BY g2."sortOrder", g2."createdAt", g2."id"
  LIMIT 1
);

-- CreateIndex
CREATE UNIQUE INDEX "product_group_householdId_starterKey_key" ON "product_group"("householdId", "starterKey");
