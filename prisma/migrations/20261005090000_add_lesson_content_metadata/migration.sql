ALTER TABLE "Lesson"
  ADD COLUMN "contentVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "contentSizeBytes" INTEGER,
  ADD COLUMN "contentChecksum" TEXT;
