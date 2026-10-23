-- AlterTable
ALTER TABLE "calendar_sync" ADD COLUMN     "includeAssignments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "includeSchoolTasks" BOOLEAN NOT NULL DEFAULT true;
