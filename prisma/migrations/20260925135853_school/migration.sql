-- CreateEnum
CREATE TYPE "SchoolTaskKind" AS ENUM ('FORM', 'FEE', 'SUPPLIES', 'OTHER');

-- CreateEnum
CREATE TYPE "SchoolTaskStatus" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('TODO', 'DONE', 'MISSING');

-- CreateTable
CREATE TABLE "school_profile" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "grade" TEXT,
    "schoolYear" TEXT,
    "transportNotes" TEXT,
    "lunchNotes" TEXT,
    "scheduleNotes" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_contact" (
    "profileId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "school_contact_pkey" PRIMARY KEY ("profileId","personId")
);

-- CreateTable
CREATE TABLE "school_task" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kidPersonId" TEXT,
    "title" TEXT NOT NULL,
    "kind" "SchoolTaskKind" NOT NULL DEFAULT 'OTHER',
    "dueDate" TIMESTAMP(3),
    "amountCents" INTEGER,
    "ownerPersonId" TEXT,
    "status" "SchoolTaskStatus" NOT NULL DEFAULT 'OPEN',
    "doneAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_assignment" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "AssignmentStatus" NOT NULL DEFAULT 'TODO',
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_profile_personId_key" ON "school_profile"("personId");

-- CreateIndex
CREATE INDEX "school_task_householdId_status_dueDate_idx" ON "school_task"("householdId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "school_assignment_profileId_status_dueDate_idx" ON "school_assignment"("profileId", "status", "dueDate");

-- AddForeignKey
ALTER TABLE "school_profile" ADD CONSTRAINT "school_profile_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_contact" ADD CONSTRAINT "school_contact_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "school_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_contact" ADD CONSTRAINT "school_contact_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_task" ADD CONSTRAINT "school_task_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_task" ADD CONSTRAINT "school_task_kidPersonId_fkey" FOREIGN KEY ("kidPersonId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_task" ADD CONSTRAINT "school_task_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_assignment" ADD CONSTRAINT "school_assignment_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "school_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
