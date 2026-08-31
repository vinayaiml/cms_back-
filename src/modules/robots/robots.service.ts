import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LicenseStatus } from '@prisma/client';
import { randomBytes } from 'crypto';

@Injectable()
export class RobotsService {
  constructor(private prisma: PrismaService) {}

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

  async listByOrg(orgId: number, opts: { includeLicenseKey: boolean }) {
    return this.prisma.robot.findMany({
      where: { orgId },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        orgId: true,
        serialNumber: true,
        name: true,
        licenseKey: opts.includeLicenseKey,
        validFrom: true,
        validUntil: true,
        licenseStatus: true,
        revokedAt: true,
        lastSeenAt: true,
        appVersion: true,
        deviceModel: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async listAll(orgId?: number) {
    return this.prisma.robot.findMany({
      where: orgId ? { orgId } : {},
      orderBy: { id: 'desc' },
      select: {
        id: true,
        orgId: true,
        org: { select: { id: true, name: true } },
        serialNumber: true,
        name: true,
        licenseKey: true, // Super Admin only endpoint
        validFrom: true,
        validUntil: true,
        licenseStatus: true,
        revokedAt: true,
        lastSeenAt: true,
        appVersion: true,
        deviceModel: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async createRobot(input: {
    orgId: number;
    serialNumber: string;
    name?: string;
    validFrom: Date;
    validUntil: Date;
  }) {
    const licenseKey = this.generateLicenseKey();
    const status = this.computeLicenseStatus(input.validUntil, null);

    return this.prisma.robot.create({
      data: {
        orgId: input.orgId,
        serialNumber: input.serialNumber,
        name: input.name,
        licenseKey,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        licenseStatus: status,
      },
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
    });
  }

  async lockRobot(robotId: number, lock: boolean) {
    const robot = await this.prisma.robot.findUnique({ where: { id: robotId } });
    if (!robot) throw new NotFoundException('Robot not found');

    if (lock) {
      return this.prisma.robot.update({
        where: { id: robotId },
        data: { revokedAt: new Date(), licenseStatus: LicenseStatus.REVOKED },
      });
    }

    // unlock (revokedAt cleared; status recalculated)
    const status = this.computeLicenseStatus(robot.validUntil, null);

    return this.prisma.robot.update({
      where: { id: robotId },
      data: { revokedAt: null, licenseStatus: status },
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
