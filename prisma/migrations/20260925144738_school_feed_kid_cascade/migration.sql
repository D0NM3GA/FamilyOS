-- DropForeignKey
ALTER TABLE "school_feed" DROP CONSTRAINT "school_feed_kidPersonId_fkey";

-- AddForeignKey
ALTER TABLE "school_feed" ADD CONSTRAINT "school_feed_kidPersonId_fkey" FOREIGN KEY ("kidPersonId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
