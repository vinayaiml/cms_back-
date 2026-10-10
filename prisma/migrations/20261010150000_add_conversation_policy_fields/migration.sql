-- AlterTable OrganizationPersonaConfig
ALTER TABLE "OrganizationPersonaConfig" ADD COLUMN "speechSpeed" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
ALTER TABLE "OrganizationPersonaConfig" ADD COLUMN "sessionMaxSeconds" INTEGER NOT NULL DEFAULT 300;
ALTER TABLE "OrganizationPersonaConfig" ADD COLUMN "sessionIdleTimeoutSeconds" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "OrganizationPersonaConfig" ADD COLUMN "cooldownSeconds" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "OrganizationPersonaConfig" ADD COLUMN "dailySessionLimit" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "OrganizationPersonaConfig" ADD COLUMN "supportedLanguages" TEXT NOT NULL DEFAULT 'en-US';

-- AlterTable RobotPersonaConfig
ALTER TABLE "RobotPersonaConfig" ADD COLUMN "speechSpeed" DOUBLE PRECISION;
ALTER TABLE "RobotPersonaConfig" ADD COLUMN "sessionMaxSeconds" INTEGER;
ALTER TABLE "RobotPersonaConfig" ADD COLUMN "sessionIdleTimeoutSeconds" INTEGER;
ALTER TABLE "RobotPersonaConfig" ADD COLUMN "cooldownSeconds" INTEGER;
ALTER TABLE "RobotPersonaConfig" ADD COLUMN "dailySessionLimit" INTEGER;
ALTER TABLE "RobotPersonaConfig" ADD COLUMN "supportedLanguages" TEXT;
