-- CreateEnum
CREATE TYPE "ViewMode" AS ENUM ('BIG', 'FULL');

-- CreateEnum
CREATE TYPE "BunsonVolume" AS ENUM ('CHATTY', 'CHEERS', 'OFF');

-- AlterTable
ALTER TABLE "person" ADD COLUMN     "bunsonVolume" "BunsonVolume" NOT NULL DEFAULT 'CHATTY',
ADD COLUMN     "viewMode" "ViewMode";
