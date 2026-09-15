ALTER TABLE "Robot" ADD COLUMN "licenseKeyCiphertext" TEXT;
ALTER TABLE "Robot" ADD COLUMN "licenseKeyFingerprint" TEXT;
ALTER TABLE "Robot" ALTER COLUMN "licenseKey" DROP NOT NULL;

CREATE UNIQUE INDEX "Robot_licenseKeyFingerprint_key" ON "Robot"("licenseKeyFingerprint");
