-- AlterTable: Add new columns with default values for existing rows
ALTER TABLE `Organization` ADD COLUMN `state` VARCHAR(191) NOT NULL DEFAULT 'Delhi';
ALTER TABLE `Organization` ADD COLUMN `city` VARCHAR(191) NOT NULL DEFAULT 'New Delhi';

-- Remove defaults after adding (optional, keeps schema clean)
ALTER TABLE `Organization` ALTER COLUMN `state` DROP DEFAULT;
ALTER TABLE `Organization` ALTER COLUMN `city` DROP DEFAULT;
