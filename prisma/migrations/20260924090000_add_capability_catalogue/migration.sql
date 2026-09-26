CREATE TABLE "Capability" (
  "id" SERIAL NOT NULL,
  "stableKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "version" INTEGER NOT NULL,
  "requiredHardware" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Capability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Capability_stableKey_key" ON "Capability"("stableKey");
