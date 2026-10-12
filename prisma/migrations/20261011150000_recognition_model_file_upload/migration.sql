-- AlterTable
ALTER TABLE "RecognitionModel" ADD COLUMN     "fileBytes" BYTEA,
ADD COLUMN     "uploadedAt" TIMESTAMP(3),
ADD COLUMN     "uploadedByUserId" INTEGER;
