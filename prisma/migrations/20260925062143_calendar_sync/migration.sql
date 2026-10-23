-- CreateTable
CREATE TABLE "calendar_sync" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "ownerPersonId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "calendarName" TEXT NOT NULL,
    "includeDates" BOOLEAN NOT NULL DEFAULT true,
    "includeVehicles" BOOLEAN NOT NULL DEFAULT true,
    "includeChores" BOOLEAN NOT NULL DEFAULT false,
    "includeMeds" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastResult" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "retryAfterUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event_link" (
    "syncId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "graphEventId" TEXT,
    "contentHash" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_event_link_pkey" PRIMARY KEY ("syncId","sourceKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_sync_householdId_key" ON "calendar_sync"("householdId");

-- AddForeignKey
ALTER TABLE "calendar_sync" ADD CONSTRAINT "calendar_sync_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_sync" ADD CONSTRAINT "calendar_sync_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_event_link" ADD CONSTRAINT "calendar_event_link_syncId_fkey" FOREIGN KEY ("syncId") REFERENCES "calendar_sync"("id") ON DELETE CASCADE ON UPDATE CASCADE;
