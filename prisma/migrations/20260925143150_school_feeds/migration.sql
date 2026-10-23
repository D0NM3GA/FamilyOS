-- CreateTable
CREATE TABLE "school_feed" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kidPersonId" TEXT,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptedValue" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "urlHash" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastFetchedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "etag" TEXT,
    "lastModified" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_feed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_feed_event" (
    "feedId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL,

    CONSTRAINT "school_feed_event_pkey" PRIMARY KEY ("feedId","occurrenceKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_feed_householdId_urlHash_key" ON "school_feed"("householdId", "urlHash");

-- CreateIndex
CREATE INDEX "school_feed_event_feedId_startsAt_idx" ON "school_feed_event"("feedId", "startsAt");

-- AddForeignKey
ALTER TABLE "school_feed" ADD CONSTRAINT "school_feed_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_feed" ADD CONSTRAINT "school_feed_kidPersonId_fkey" FOREIGN KEY ("kidPersonId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_feed_event" ADD CONSTRAINT "school_feed_event_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "school_feed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
