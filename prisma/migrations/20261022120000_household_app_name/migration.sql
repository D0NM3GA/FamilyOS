-- Each family names the app themselves (Settings -> Household); null means the default, FamilyOS.

-- AlterTable
ALTER TABLE "household" ADD COLUMN     "appName" TEXT;
