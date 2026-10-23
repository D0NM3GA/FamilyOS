-- Phase 22: every list row is a Pantry item; "How it comes" replaces QuantityUnit.
-- Free-text rows have no product to point at, so they are dropped (dev data only).
DELETE FROM "shopping_list_item" WHERE "productId" IS NULL;

-- DropForeignKey
ALTER TABLE "product" DROP CONSTRAINT "product_defaultUnitId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_item" DROP CONSTRAINT "purchase_item_unitId_fkey";

-- DropForeignKey
ALTER TABLE "quantity_unit" DROP CONSTRAINT "quantity_unit_householdId_fkey";

-- DropForeignKey
ALTER TABLE "shopping_list_item" DROP CONSTRAINT "shopping_list_item_productId_fkey";

-- DropForeignKey
ALTER TABLE "shopping_list_item" DROP CONSTRAINT "shopping_list_item_unitId_fkey";

-- AlterTable
ALTER TABLE "product" DROP COLUMN "defaultUnitId",
ADD COLUMN     "container" TEXT,
ADD COLUMN     "nameKey" TEXT,
ADD COLUMN     "sizeAmount" DOUBLE PRECISION,
ADD COLUMN     "sizeUnit" TEXT;

-- Backfill with the app's own key (lib/product-name.ts productNameKey): lowercase, anything
-- but letters/digits/% becomes a space, and a plain trailing "s" drops from words of four or
-- more letters. Only accent-stripping isn't mirrored here (no unaccent extension). Any
-- existing look-alikes get a unique suffix; the Pantry's "Same as..." merge tidies them.
UPDATE "product" SET "nameKey" = regexp_replace(
  trim(regexp_replace(lower("name"), '[^a-z0-9%]+', ' ', 'g')),
  '(^| )([a-z0-9%]{2,}[a-rt-z0-9%])s(?= |$)', '\1\2', 'g');
UPDATE "product" p SET "nameKey" = p."nameKey" || '#' || p."id"
  WHERE p."nameKey" = ''
     OR EXISTS (SELECT 1 FROM "product" q WHERE q."householdId" = p."householdId" AND q."nameKey" = p."nameKey" AND q."id" < p."id");
ALTER TABLE "product" ALTER COLUMN "nameKey" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_group" ADD COLUMN     "emoji" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "purchase_item" DROP COLUMN "unitId";

-- AlterTable
ALTER TABLE "shopping_list_item" DROP COLUMN "freeText",
DROP COLUMN "unitId",
ALTER COLUMN "productId" SET NOT NULL;

-- DropTable
DROP TABLE "quantity_unit";

-- CreateIndex
CREATE UNIQUE INDEX "product_householdId_nameKey_key" ON "product"("householdId", "nameKey");

-- AddForeignKey
ALTER TABLE "shopping_list_item" ADD CONSTRAINT "shopping_list_item_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

