-- AlterEnum
ALTER TYPE "JarEventKind" ADD VALUE 'NEW_FILED';

-- AlterTable
ALTER TABLE "money_jar_member" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

