-- Phase 70a: Outlook calendars copied in the background (each person's own, and the family's).
-- CreateEnum
CREATE TYPE "OutlookCalendarKind" AS ENUM ('PERSON', 'FAMILY');

-- CreateTable
CREATE TABLE "outlook_calendar" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "kind" "OutlookCalendarKind" NOT NULL,
    "personId" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "graphCalendarId" TEXT,
    "calendarName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "leaseUntil" TIMESTAMP(3),
    "lastFetchedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "retryAfterUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlook_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlook_event" (
    "outlookCalendarId" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,
    "iCalUId" TEXT,
    "title" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL,
    "isPrivate" BOOLEAN NOT NULL,

    CONSTRAINT "outlook_event_pkey" PRIMARY KEY ("outlookCalendarId","graphId")
);

-- CreateIndex
CREATE UNIQUE INDEX "outlook_calendar_householdId_kind_personId_key" ON "outlook_calendar"("householdId", "kind", "personId");

-- CreateIndex
CREATE INDEX "outlook_event_outlookCalendarId_startsAt_idx" ON "outlook_event"("outlookCalendarId", "startsAt");

-- AddForeignKey
ALTER TABLE "outlook_calendar" ADD CONSTRAINT "outlook_calendar_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlook_calendar" ADD CONSTRAINT "outlook_calendar_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlook_event" ADD CONSTRAINT "outlook_event_outlookCalendarId_fkey" FOREIGN KEY ("outlookCalendarId") REFERENCES "outlook_calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One family calendar per household.
CREATE UNIQUE INDEX "outlook_calendar_one_family" ON "outlook_calendar"("householdId") WHERE "kind" = 'FAMILY';
