-- CreateTable
CREATE TABLE "RobotCapabilityAssignment" (
    "id" SERIAL NOT NULL,
    "robotId" INTEGER NOT NULL,
    "capabilityId" INTEGER NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "limits" JSONB,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotCapabilityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RobotCapabilityAssignment_robotId_capabilityId_key" ON "RobotCapabilityAssignment"("robotId", "capabilityId");

-- CreateIndex
CREATE INDEX "RobotCapabilityAssignment_capabilityId_idx" ON "RobotCapabilityAssignment"("capabilityId");

-- AddForeignKey
ALTER TABLE "RobotCapabilityAssignment" ADD CONSTRAINT "RobotCapabilityAssignment_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotCapabilityAssignment" ADD CONSTRAINT "RobotCapabilityAssignment_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "Capability"("id") ON DELETE CASCADE ON UPDATE CASCADE;
