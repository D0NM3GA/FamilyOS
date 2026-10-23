-- CreateEnum
CREATE TYPE "PersonColor" AS ENUM ('SUN', 'TOMATO', 'SKY', 'LIME', 'GRAPE', 'PINK', 'ORANGE', 'TEAL');

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "color" "PersonColor",
ADD COLUMN     "navPins" TEXT[] DEFAULT ARRAY[]::TEXT[];
