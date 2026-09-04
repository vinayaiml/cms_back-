import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LicenseStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RobotsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private readonly robotSelect = {
    id: true,
    orgId: true,
    serialNumber: true,
    name: true,
    validFrom: true,
    validUntil: true,
    licenseStatus: true,
    revokedAt: true,
    lastSeenAt: true,
    appVersion: true,
    deviceModel: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  private readonly robotEnrollmentSelect = {
    ...this.robotSelect,
    licenseKey: true,
  } as const;

  private readonly robotLicenseSelect = {
    ...this.robotSelect,
    licenseKey: true,
  } as const;

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;
    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
  }

  private generateLicenseKeyCandidate(): string {
    const value = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return `WHRB${value.toString().padStart(6, '0')}`;
  }

  private async generateUniqueLicenseKey(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const licenseKey = this.generateLicenseKeyCandidate();
      const existing = await this.prisma.robot.findUnique({
        where: { licenseKey },
        select: { id: true },
      });
      if (!existing) return licenseKey;
    }

    throw new Error('Unable to generate unique robot license key');
  }

  async canViewLicenseKeys(actor: { userId: number; isSuperAdmin: boolean }) {
    if (actor.isSuperAdmin) return true;

    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      include: {
        directPermissions: { include: { permission: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });

    if (!user) return false;

    const permissions = new Set<string>();
    for (const direct of user.directPermissions) permissions.add(direct.permission.key);
    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.key);
      }
    }

    return permissions.has('robot.read') && permissions.has('license.renew');
  }

  async listByOrg(orgId: number, includeLicenseKey = false) {
    return this.prisma.robot.findMany({
      where: { orgId },
      orderBy: { id: 'desc' },
      select: includeLicenseKey ? this.robotLicenseSelect : this.robotSelect,
    });
  }

  async listAll(orgId?: number, includeLicenseKey = false) {
    return this.prisma.robot.findMany({
      where: orgId ? { orgId } : {},
      orderBy: { id: 'desc' },
      select: {
        ...(includeLicenseKey ? this.robotLicenseSelect : this.robotSelect),
        org: { select: { id: true, name: true } },
      },
    });
  }

  async createRobot(
    input: {
      orgId: number;
      serialNumber: string;
      name?: string;
      validFrom: Date;
      validUntil: Date;
    },
    actor?: { userId: number | null; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    const licenseKey = await this.generateUniqueLicenseKey();
    const status = this.computeLicenseStatus(input.validUntil, null);

    return this.prisma.$transaction(async (tx) => {
      const robot = await tx.robot.create({
        data: {
          orgId: input.orgId,
          serialNumber: input.serialNumber,
          name: input.name,
          licenseKey,
          validFrom: input.validFrom,
          validUntil: input.validUntil,
          licenseStatus: status,
        },
        select: this.robotEnrollmentSelect,
      });

      if (actor) {
        await this.audit.recordCritical(
          {
            actor,
            action: 'robot.enrolled',
            targetType: 'robot',
            targetId: robot.id,
            targetOrgId: robot.orgId,
            correlationId,
            metadata: {
              serialNumber: robot.serialNumber,
              licenseStatus: robot.licenseStatus,
              validFrom: robot.validFrom,
              validUntil: robot.validUntil,
            },
          },
          tx,
        );
      }

      return robot;
    });
  }

  async renewLicense(robotId: number, validUntil: Date) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');

    const status = this.computeLicenseStatus(validUntil, robot.revokedAt);

    // Renewal extends validity on the SAME license_key
    return this.prisma.robot.update({
      where: { id: robotId },
      data: { validUntil, licenseStatus: status },
      select: this.robotSelect,
    });
  }

  async lockRobot(robotId: number, lock: boolean) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');

    if (lock) {
      return this.prisma.robot.update({
        where: { id: robotId },
        data: { revokedAt: new Date(), licenseStatus: LicenseStatus.REVOKED },
        select: this.robotSelect,
      });
    }

    // unlock (revokedAt cleared; status recalculated)
    const status = this.computeLicenseStatus(robot.validUntil, null);

    return this.prisma.robot.update({
      where: { id: robotId },
      data: { revokedAt: null, licenseStatus: status },
      select: this.robotSelect,
    });
  }

  async clearDeviceMetadata(
    robotId: number,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    const robot = await this.getRobotOrThrow(robotId);
    await this.ensureOrgAccess(actor, robot.orgId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.robot.update({
        where: { id: robotId },
        data: {
          appVersion: null,
          deviceModel: null,
          deviceMetadata: Prisma.DbNull,
        },
        select: this.robotSelect,
      });

      await this.audit.recordCritical(
        {
          actor,
          action: 'robot.device_metadata_erased',
          targetType: 'robot',
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async getRobotOrThrow(robotId: number) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');
    return robot;
  }

  async ensureOrgAccess(actor: { orgId: number | null; isSuperAdmin: boolean }, targetOrgId: number) {
    if (actor.isSuperAdmin) return;
    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    if (actor.orgId !== targetOrgId) throw new ForbiddenException('Cannot access other org');
  }
}
