-- CreateEnum
CREATE TYPE "JarEventKind" AS ENUM ('RENAMED', 'MEMBER_ADDED', 'MEMBER_REMOVED', 'CONNECTED', 'DISCONNECTED', 'IMPORTED', 'CATEGORY_SET', 'RULE_FORGOTTEN', 'BUDGET_SET', 'BILL_ANSWERED', 'TRIP_LINKED', 'TRIP_UNLINKED', 'ORDER_LINKED', 'ORDER_UNLINKED', 'SURPRISE_MARKED', 'SURPRISE_REVEALED', 'CHAT_SET');

-- AlterTable
ALTER TABLE "jar_connection" ADD COLUMN     "fingerprint" TEXT,
ADD COLUMN     "skippedAccounts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "skippedJarId" TEXT;

-- AlterTable
ALTER TABLE "money_jar" ADD COLUMN     "teamsChatError" TEXT,
ADD COLUMN     "teamsChatId" TEXT;

-- CreateTable
CREATE TABLE "jar_event" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" "JarEventKind" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "txnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jar_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jar_chat_alert_sent" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jar_chat_alert_sent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jar_event_jarId_createdAt_idx" ON "jar_event"("jarId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "jar_chat_alert_sent_jarId_key_key" ON "jar_chat_alert_sent"("jarId", "key");

-- CreateIndex
CREATE INDEX "jar_connection_fingerprint_idx" ON "jar_connection"("fingerprint");

-- AddForeignKey
ALTER TABLE "jar_event" ADD CONSTRAINT "jar_event_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jar_event" ADD CONSTRAINT "jar_event_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jar_event" ADD CONSTRAINT "jar_event_txnId_fkey" FOREIGN KEY ("txnId") REFERENCES "fin_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jar_chat_alert_sent" ADD CONSTRAINT "jar_chat_alert_sent_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;
