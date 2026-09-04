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

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;
    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
  }

  private generateLicenseKey(): string {
    // 32 bytes -> 64 hex chars
    return randomBytes(32).toString('hex');
  }

  async listByOrg(orgId: number) {
    return this.prisma.robot.findMany({
      where: { orgId },
      orderBy: { id: 'desc' },
      select: this.robotSelect,
    });
  }

  async listAll(orgId?: number) {
    return this.prisma.robot.findMany({
      where: orgId ? { orgId } : {},
      orderBy: { id: 'desc' },
      select: {
        ...this.robotSelect,
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
    const licenseKey = this.generateLicenseKey();
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
        select: this.robotSelect,
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
