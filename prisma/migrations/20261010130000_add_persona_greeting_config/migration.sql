-- CreateTable OrganizationPersonaConfig
CREATE TABLE "OrganizationPersonaConfig" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "personaName" TEXT NOT NULL DEFAULT 'WhizRobot Assistant',
    "personaPrompt" TEXT,
    "greetingText" TEXT NOT NULL DEFAULT 'Hello! Welcome to our organization.',
    "speechGreeting" TEXT NOT NULL DEFAULT 'Hello! Welcome to our organization.',
    "voiceStyle" TEXT NOT NULL DEFAULT 'standard',
    "language" TEXT NOT NULL DEFAULT 'en-US',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationPersonaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable RobotPersonaConfig
CREATE TABLE "RobotPersonaConfig" (
    "id" SERIAL NOT NULL,
    "orgId" INTEGER NOT NULL,
    "robotId" INTEGER NOT NULL,
    "personaName" TEXT,
    "personaPrompt" TEXT,
    "greetingText" TEXT,
    "speechGreeting" TEXT,
    "voiceStyle" TEXT,
    "language" TEXT,
    "tone" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobotPersonaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationPersonaConfig_orgId_key" ON "OrganizationPersonaConfig"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "RobotPersonaConfig_robotId_key" ON "RobotPersonaConfig"("robotId");

-- CreateIndex
CREATE INDEX "RobotPersonaConfig_orgId_idx" ON "RobotPersonaConfig"("orgId");

-- AddForeignKey
ALTER TABLE "OrganizationPersonaConfig" ADD CONSTRAINT "OrganizationPersonaConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotPersonaConfig" ADD CONSTRAINT "RobotPersonaConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobotPersonaConfig" ADD CONSTRAINT "RobotPersonaConfig_robotId_fkey" FOREIGN KEY ("robotId") REFERENCES "Robot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
