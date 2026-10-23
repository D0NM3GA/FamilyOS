-- CreateEnum
CREATE TYPE "FinProvider" AS ENUM ('SIMPLEFIN', 'PRIVACY');

-- CreateEnum
CREATE TYPE "FinSource" AS ENUM ('SIMPLEFIN', 'MANUAL');

-- CreateEnum
CREATE TYPE "FinTxnState" AS ENUM ('ACTIVE', 'DUPLICATE', 'SUPERSEDED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReconcileKind" AS ENUM ('POSSIBLE_DUPLICATE', 'SYNC_ERROR');

-- CreateEnum
CREATE TYPE "ReconcileResolution" AS ENUM ('SAME', 'DIFFERENT', 'DISMISSED');

-- CreateTable
CREATE TABLE "money_jar" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_jar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_jar_member" (
    "jarId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "money_jar_member_pkey" PRIMARY KEY ("jarId","personId")
);

-- CreateTable
CREATE TABLE "jar_connection" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "provider" "FinProvider" NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptedValue" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerMessage" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "retryAfterUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jar_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_account" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "source" "FinSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "org" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "balanceCents" INTEGER,
    "availableCents" INTEGER,
    "balanceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fin_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fin_transaction" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" "FinSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "postedOn" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "payee" TEXT,
    "memo" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "state" "FinTxnState" NOT NULL DEFAULT 'ACTIVE',
    "duplicateOfId" TEXT,
    "merchantName" TEXT,
    "privacyCardMemo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fin_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_charge" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "cardToken" TEXT,
    "cardMemo" TEXT,
    "cardLast4" TEXT,
    "merchant" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "matchedTxnId" TEXT,

    CONSTRAINT "privacy_charge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconcile_issue" (
    "id" TEXT NOT NULL,
    "jarId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "ReconcileKind" NOT NULL,
    "txnId" TEXT,
    "otherTxnId" TEXT,
    "accountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" "ReconcileResolution",

    CONSTRAINT "reconcile_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jar_connection_jarId_provider_key" ON "jar_connection"("jarId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "fin_account_jarId_source_externalId_key" ON "fin_account"("jarId", "source", "externalId");

-- CreateIndex
CREATE INDEX "fin_transaction_jarId_postedOn_idx" ON "fin_transaction"("jarId", "postedOn");

-- CreateIndex
CREATE UNIQUE INDEX "fin_transaction_accountId_source_externalId_key" ON "fin_transaction"("accountId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_charge_jarId_token_key" ON "privacy_charge"("jarId", "token");

-- CreateIndex
CREATE UNIQUE INDEX "reconcile_issue_jarId_key_key" ON "reconcile_issue"("jarId", "key");

-- AddForeignKey
ALTER TABLE "money_jar" ADD CONSTRAINT "money_jar_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_jar_member" ADD CONSTRAINT "money_jar_member_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_jar_member" ADD CONSTRAINT "money_jar_member_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jar_connection" ADD CONSTRAINT "jar_connection_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jar_connection" ADD CONSTRAINT "jar_connection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_account" ADD CONSTRAINT "fin_account_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_transaction" ADD CONSTRAINT "fin_transaction_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_transaction" ADD CONSTRAINT "fin_transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fin_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fin_transaction" ADD CONSTRAINT "fin_transaction_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "fin_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_charge" ADD CONSTRAINT "privacy_charge_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_charge" ADD CONSTRAINT "privacy_charge_matchedTxnId_fkey" FOREIGN KEY ("matchedTxnId") REFERENCES "fin_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile_issue" ADD CONSTRAINT "reconcile_issue_jarId_fkey" FOREIGN KEY ("jarId") REFERENCES "money_jar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile_issue" ADD CONSTRAINT "reconcile_issue_txnId_fkey" FOREIGN KEY ("txnId") REFERENCES "fin_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile_issue" ADD CONSTRAINT "reconcile_issue_otherTxnId_fkey" FOREIGN KEY ("otherTxnId") REFERENCES "fin_transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconcile_issue" ADD CONSTRAINT "reconcile_issue_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "fin_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "jar_connection" ADD COLUMN     "lastSuccessAt" TIMESTAMP(3);

