-- CreateEnum
CREATE TYPE "TaskDomain" AS ENUM ('CHORE', 'MED', 'VEHICLE');

-- CreateEnum
CREATE TYPE "FrequencyType" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'INTERVAL_DAYS', 'DAYS_OF_WEEK');

-- CreateEnum
CREATE TYPE "AssignmentStrategy" AS ENUM ('FIXED', 'ROUND_ROBIN', 'LEAST_ASSIGNED');

-- CreateEnum
CREATE TYPE "TaskInstanceStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- CreateTable
CREATE TABLE "task_definition" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "domain" "TaskDomain" NOT NULL DEFAULT 'CHORE',
    "frequencyType" "FrequencyType" NOT NULL,
    "interval" INTEGER,
    "daysOfWeek" INTEGER[],
    "startDate" TIMESTAMP(3) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "assignmentStrategy" "AssignmentStrategy" NOT NULL DEFAULT 'FIXED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_instance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "assignedToId" TEXT,
    "status" "TaskInstanceStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_ledger" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT,
    "instanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_TaskAssignees" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskAssignees_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_instance_definitionId_dueDate_key" ON "task_instance"("definitionId", "dueDate");

-- CreateIndex
CREATE INDEX "_TaskAssignees_B_index" ON "_TaskAssignees"("B");

-- AddForeignKey
ALTER TABLE "task_definition" ADD CONSTRAINT "task_definition_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_instance" ADD CONSTRAINT "task_instance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "task_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_instance" ADD CONSTRAINT "task_instance_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_instance" ADD CONSTRAINT "task_instance_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "task_instance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskAssignees" ADD CONSTRAINT "_TaskAssignees_A_fkey" FOREIGN KEY ("A") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskAssignees" ADD CONSTRAINT "_TaskAssignees_B_fkey" FOREIGN KEY ("B") REFERENCES "task_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
