-- CreateTable
CREATE TABLE "system_heartbeat" (
    "name" TEXT NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "detail" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_heartbeat_pkey" PRIMARY KEY ("name")
);
