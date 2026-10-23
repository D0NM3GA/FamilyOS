-- CreateTable
CREATE TABLE "server_secret" (
    "name" TEXT NOT NULL,
    "encryptedValue" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_secret_pkey" PRIMARY KEY ("name")
);
