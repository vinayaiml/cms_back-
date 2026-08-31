-- CreateTable
CREATE TABLE `OrgPermission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orgId` INTEGER NOT NULL,
    `permissionId` INTEGER NOT NULL,

    INDEX `OrgPermission_orgId_idx`(`orgId`),
    UNIQUE INDEX `OrgPermission_orgId_permissionId_key`(`orgId`, `permissionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `OrgPermission` ADD CONSTRAINT `OrgPermission_orgId_fkey` FOREIGN KEY (`orgId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrgPermission` ADD CONSTRAINT `OrgPermission_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `Permission`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
