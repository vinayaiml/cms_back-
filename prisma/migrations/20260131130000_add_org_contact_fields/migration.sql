-- Add authorizedPersonName and contactNo columns to Organization table with default values for existing rows
ALTER TABLE `Organization` ADD COLUMN `authorizedPersonName` VARCHAR(191) NOT NULL DEFAULT 'Not Specified';
ALTER TABLE `Organization` ADD COLUMN `contactNo` VARCHAR(191) NOT NULL DEFAULT '0000000000';
