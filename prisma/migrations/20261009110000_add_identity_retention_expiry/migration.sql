ALTER TABLE "IdentityEmbeddingRecord"
  ADD COLUMN "retentionExpiresAt" TIMESTAMP(3);

CREATE INDEX "IdentityEmbeddingRecord_orgId_retentionExpiresAt_idx"
  ON "IdentityEmbeddingRecord"("orgId", "retentionExpiresAt");
