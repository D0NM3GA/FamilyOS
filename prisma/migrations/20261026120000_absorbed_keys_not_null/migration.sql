-- Phase 37 follow-up: category code reads absorbedKeys as a list, never null (like
-- household.disabledApps). The column default already fills every row.

UPDATE "fin_category" SET "absorbedKeys" = ARRAY[]::TEXT[] WHERE "absorbedKeys" IS NULL;
ALTER TABLE "fin_category" ALTER COLUMN "absorbedKeys" SET NOT NULL;
