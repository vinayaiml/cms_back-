import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LicenseStatus } from '@prisma/client';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { RobotLoginDto } from './auth.dto';

const activeLogin: RobotLoginDto = {
  licenseKey: 'WHRB000001',
  serialNumber: 'WR-001',
  deviceMetadata: {
    manufacturer: 'Sanbot',
    model: 'Mini ELF',
    androidVersion: '7.1.2',
    apiLevel: 25,
    appVersionName: '0.1.0',
    appVersionCode: 2,
  },
  deviceMetadataConsent: true,
};

function buildRobot(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    orgId: 1,
    serialNumber: 'WR-001',
    name: 'Demo Robot',
    licenseKey: 'WHRB000001',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: new Date('2099-01-01T00:00:00.000Z'),
    licenseStatus: LicenseStatus.ACTIVE,
    revokedAt: null,
    org: { isActive: true },
    ...overrides,
  };
}

describe('AuthService robot login', () => {
  const prisma = {
    robot: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    event: {
      create: jest.fn(),
    },
  };
  const jwt = {
    sign: jest.fn(),
  };

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(prisma as unknown as PrismaService, jwt as unknown as JwtService);
    jwt.sign.mockReturnValue('robot-jwt');
  });

  it('stores Android robot metadata as digests and does not return the license key', async () => {
    prisma.robot.findUnique.mockResolvedValue(buildRobot());
    prisma.robot.update.mockResolvedValue({});

    const result = await service.loginRobot(activeLogin);

    expect(prisma.robot.findUnique).toHaveBeenCalledWith({
      where: { licenseKey: 'WHRB000001' },
      include: { org: { select: { isActive: true } } },
    });
    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        lastSeenAt: expect.any(Date),
        appVersion: '0.1.0',
        deviceModel: null,
        deviceMetadata: {
          schemaVersion: 1,
          storage: 'sha256-digest',
          consent: {
            deviceMetadata: true,
          },
          identity: {
            manufacturerSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            modelSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            androidVersionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
          apiLevel: 25,
          appVersionName: '0.1.0',
          appVersionCode: 2,
        },
      },
    });
    expect(result.token).toBe('robot-jwt');
    expect(result.robot.serialNumber).toBe('WR-001');
    expect(result.license).not.toHaveProperty('licenseKey');
  });

  it('accepts Android login without device metadata consent and stores implied consent', async () => {
    prisma.robot.findUnique.mockResolvedValue(buildRobot());
    prisma.robot.update.mockResolvedValue({});

    const { deviceMetadataConsent: _omitted, ...androidLogin } = activeLogin;

    await service.loginRobot(androidLogin);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        deviceMetadata: expect.objectContaining({
          consent: {
            deviceMetadata: true,
          },
        }),
      }),
    });
  });

  it('rejects a stolen license key when the serial number does not match', async () => {
    prisma.robot.findUnique.mockResolvedValue(buildRobot({ serialNumber: 'WR-002' }));

    await expect(service.loginRobot(activeLogin)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.event.create).toHaveBeenCalledWith({
      data: {
        orgId: 1,
        robotId: 10,
        type: 'ROBOT_LOGIN_REJECTED',
        payload: {
          reason: 'SERIAL_MISMATCH',
          endpoint: 'robot.login',
        },
      },
    });
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(prisma.robot.update).not.toHaveBeenCalled();
  });

  it('rejects inactive organizations without issuing a token', async () => {
    prisma.robot.findUnique.mockResolvedValue(buildRobot({ org: { isActive: false } }));

    await expect(service.loginRobot(activeLogin)).rejects.toBeInstanceOf(DomainLockedException);

    expect(prisma.event.create).toHaveBeenCalledWith({
      data: {
        orgId: 1,
        robotId: 10,
        type: 'ROBOT_LOGIN_REJECTED',
        payload: {
          reason: 'ORG_INACTIVE',
          endpoint: 'robot.login',
        },
      },
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('rejects expired licenses without issuing a token', async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        validUntil: new Date('2020-01-01T00:00:00.000Z'),
        licenseStatus: LicenseStatus.ACTIVE,
      }),
    );
    prisma.robot.update.mockResolvedValue({});

    await expect(service.loginRobot(activeLogin)).rejects.toBeInstanceOf(DomainLockedException);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { licenseStatus: LicenseStatus.EXPIRED },
    });
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: {
        orgId: 1,
        robotId: 10,
        type: 'ROBOT_LOGIN_REJECTED',
        payload: {
          reason: 'LICENSE_EXPIRED',
          endpoint: 'robot.login',
        },
      },
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('rejects revoked licenses without issuing a token', async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        revokedAt: new Date('2026-02-01T00:00:00.000Z'),
        licenseStatus: LicenseStatus.ACTIVE,
      }),
    );
    prisma.robot.update.mockResolvedValue({});

    await expect(service.loginRobot(activeLogin)).rejects.toBeInstanceOf(DomainLockedException);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { licenseStatus: LicenseStatus.REVOKED },
    });
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: {
        orgId: 1,
        robotId: 10,
        type: 'ROBOT_LOGIN_REJECTED',
        payload: {
          reason: 'LICENSE_REVOKED',
          endpoint: 'robot.login',
        },
      },
    });
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
