-- Phase 56: decorations slide along their surface instead of sitting in one of five slots, so
-- each keeps its own spot. The two floor slots become the one floor, each at the spot it stood.
ALTER TABLE "pet_item" ADD COLUMN "x" INTEGER;
ALTER TABLE "pet_item" ADD COLUMN "y" INTEGER;
UPDATE "pet_item" SET "place" = 'floor', "x" = 62, "y" = 228 WHERE "place" = 'floor-left';
UPDATE "pet_item" SET "place" = 'floor', "x" = 258, "y" = 205 WHERE "place" = 'floor-right';
