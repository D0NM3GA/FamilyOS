-- Phase 70f: a school feed for several kids (or the whole family, said explicitly).
ALTER TABLE "school_feed" ADD COLUMN "forFamily" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "school_feed_kid" (
    "feedId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,

    CONSTRAINT "school_feed_kid_pkey" PRIMARY KEY ("feedId","personId")
);

CREATE INDEX "school_feed_kid_personId_idx" ON "school_feed_kid"("personId");

ALTER TABLE "school_feed_kid" ADD CONSTRAINT "school_feed_kid_feedId_fkey" FOREIGN KEY ("feedId") REFERENCES "school_feed"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "school_feed_kid" ADD CONSTRAINT "school_feed_kid_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing feeds keep who they were for.
UPDATE "school_feed" SET "forFamily" = true WHERE "kidPersonId" IS NULL;
INSERT INTO "school_feed_kid" ("feedId", "personId") SELECT "id", "kidPersonId" FROM "school_feed" WHERE "kidPersonId" IS NOT NULL;

ALTER TABLE "school_feed" DROP CONSTRAINT "school_feed_kidPersonId_fkey";
ALTER TABLE "school_feed" DROP COLUMN "kidPersonId";
