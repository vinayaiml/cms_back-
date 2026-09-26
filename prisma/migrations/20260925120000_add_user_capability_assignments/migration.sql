-- CreateTable
CREATE TABLE "UserCapabilityAssignment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "capabilityId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCapabilityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCapabilityAssignment_userId_capabilityId_key" ON "UserCapabilityAssignment"("userId", "capabilityId");

-- CreateIndex
CREATE INDEX "UserCapabilityAssignment_capabilityId_idx" ON "UserCapabilityAssignment"("capabilityId");

-- AddForeignKey
ALTER TABLE "UserCapabilityAssignment" ADD CONSTRAINT "UserCapabilityAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCapabilityAssignment" ADD CONSTRAINT "UserCapabilityAssignment_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
