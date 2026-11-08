-- Phase 70b: who's driving to a copied Outlook event.
-- CreateTable
CREATE TABLE "event_driver" (
    "id" TEXT NOT NULL,
    "outlookCalendarId" TEXT NOT NULL,
    "graphId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "setById" TEXT,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_driver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_driver_personId_idx" ON "event_driver"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "event_driver_outlookCalendarId_graphId_key" ON "event_driver"("outlookCalendarId", "graphId");

-- AddForeignKey
ALTER TABLE "event_driver" ADD CONSTRAINT "event_driver_outlookCalendarId_fkey" FOREIGN KEY ("outlookCalendarId") REFERENCES "outlook_calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_driver" ADD CONSTRAINT "event_driver_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_driver" ADD CONSTRAINT "event_driver_setById_fkey" FOREIGN KEY ("setById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

