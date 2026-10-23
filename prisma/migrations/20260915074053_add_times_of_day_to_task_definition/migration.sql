-- AlterTable
ALTER TABLE "task_definition" ADD COLUMN     "timesOfDay" TEXT[] DEFAULT ARRAY[]::TEXT[];
