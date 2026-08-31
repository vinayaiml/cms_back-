import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtPayload } from '../../common/auth/jwt.types';
import { LicenseStatus } from '@prisma/client';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async loginUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    if (user.isLocked) {
      throw new ForbiddenException('Account is locked. Contact your administrator.');
    }

    if (!user.isSuperAdmin && !user.orgId) {
      throw new ForbiddenException('User has no organization assigned');
    }

    const payload: JwtPayload = {
      type: 'user',
      sub: user.id,
      orgId: user.orgId ?? null,
      isSuperAdmin: user.isSuperAdmin,
    };

    return {
      token: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        orgId: user.orgId,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;

    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
  }

  async loginRobot(licenseKey: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { licenseKey },
      include: { org: { select: { isActive: true } } },
    });
    if (!robot) throw new UnauthorizedException('Invalid license');

    if (!robot.org.isActive) {
      await this.prisma.event.create({
        data: {
          orgId: robot.orgId,
          robotId: robot.id,
          type: 'ROBOT_ACCESS_REJECTED_ORG_INACTIVE',
          payload: {
            reason: 'ORG_INACTIVE',
            endpoint: 'robot.login',
          },
        },
      });
      throw new DomainLockedException('ORG_INACTIVE', 'Organization is inactive');
    }

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);

    // keep DB status updated (cheap + keeps sync consistent)
    if (robot.licenseStatus !== status) {
      await this.prisma.robot.update({
        where: { id: robot.id },
        data: { licenseStatus: status },
      });
    }

    await this.prisma.robot.update({
      where: { id: robot.id },
      data: { lastSeenAt: new Date() },
    });

    const payload: JwtPayload = {
      type: 'robot',
      sub: robot.id,
      orgId: robot.orgId,
    };

    const locked = status === LicenseStatus.EXPIRED || status === LicenseStatus.REVOKED;

    return {
      token: this.jwt.sign(payload),
      robot: {
        id: robot.id,
        orgId: robot.orgId,
        serialNumber: robot.serialNumber,
        name: robot.name,
      },
      license: {
        licenseKey: robot.licenseKey,
        validFrom: robot.validFrom,
        validUntil: robot.validUntil,
        status,
        locked,
      },
    };
  }
}
