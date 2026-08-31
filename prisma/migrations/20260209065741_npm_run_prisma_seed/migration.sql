-- AlterTable
ALTER TABLE `user` ADD COLUMN `createdByUserId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `User_createdByUserId_idx` ON `User`(`createdByUserId`);

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
