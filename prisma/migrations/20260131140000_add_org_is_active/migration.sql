-- Add isActive column to Organization table with default value true
ALTER TABLE `Organization` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;
