-- AlterTable
ALTER TABLE "person" ADD COLUMN     "entraSyncedAt" TIMESTAMP(3),
ADD COLUMN     "photo" BYTEA,
ADD COLUMN     "photoContentType" TEXT;
