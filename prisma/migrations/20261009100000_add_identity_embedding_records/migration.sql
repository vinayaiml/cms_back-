CREATE TABLE "IdentityEmbeddingRecord" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "subjectRef" TEXT NOT NULL,
    "consentGranted" BOOLEAN NOT NULL DEFAULT false,
    "consentSource" TEXT NOT NULL,
    "consentPolicyVersion" TEXT NOT NULL,
    "consentGrantedAt" TIMESTAMP(3) NOT NULL,
    "embeddingCiphertext" TEXT,
    "embeddingFingerprint" TEXT,
    "embeddingSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "deletionReason" TEXT,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdentityEmbeddingRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdentityEmbeddingRecord_orgId_subjectRef_key" ON "IdentityEmbeddingRecord"("orgId", "subjectRef");
CREATE INDEX "IdentityEmbeddingRecord_orgId_status_idx" ON "IdentityEmbeddingRecord"("orgId", "status");

ALTER TABLE "IdentityEmbeddingRecord" ADD CONSTRAINT "IdentityEmbeddingRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
