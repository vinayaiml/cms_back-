import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LicenseStatus } from '@prisma/client';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { RobotLoginDto } from './auth.dto';
import { licenseFingerprint } from '../../common/security/license-secret';

process.env.LICENSE_SECRET_KEY = 'unit-test-license-secret-minimum-32-characters';

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
    licenseKeyCiphertext: null,
    licenseKeyFingerprint: licenseFingerprint('WHRB000001'),
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
    user: {
      findUnique: jest.fn(),
    },
    robot: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    event: {
      create: jest.fn(),
    },
  };
  const jwt = {
    sign: jest.fn(),
    verify: jest.fn(),
  };
  const audit = {
    recordBestEffort: jest.fn(),
  };

  let service: AuthService;
  let rateLimit: AuthRateLimitService;

  beforeEach(() => {
    jest.clearAllMocks();
    rateLimit = new AuthRateLimitService();
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      rateLimit,
      audit as unknown as AuditService,
    );
    jwt.sign.mockImplementation((_payload, options) =>
      options?.expiresIn === '7d' ? 'robot-refresh-jwt' : 'robot-access-jwt',
    );
  });

  it('stores Android robot metadata as digests and does not return the license key', async () => {
    prisma.robot.findFirst.mockResolvedValue(buildRobot());
    prisma.robot.update.mockResolvedValue({});

    const result = await service.loginRobot(activeLogin);

    expect(prisma.robot.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { licenseKeyFingerprint: licenseFingerprint('WHRB000001') },
          { licenseKey: 'WHRB000001' },
        ],
      },
      include: { org: { select: { isActive: true } } },
    });
    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        lastSeenAt: expect.any(Date),
        appVersion: '0.1.0',
        deviceModel: 'Mini ELF',
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
    expect(result.token).toBe('robot-access-jwt');
    expect(result.accessToken).toBe('robot-access-jwt');
    expect(result.refreshToken).toBe('robot-refresh-jwt');
    expect(result.expiresIn).toBe(900);
    expect(result.refreshExpiresIn).toBe(604800);
    expect(result.tokenType).toBe('Bearer');
    expect(result.robot.serialNumber).toBe('WR-001');
    expect(result.license).not.toHaveProperty('licenseKey');
    expect(jwt.sign).toHaveBeenCalledWith(
      {
        type: 'robot',
        tokenUse: 'access',
        sub: 10,
        orgId: 1,
      },
      { expiresIn: '15m' },
    );
    expect(jwt.sign).toHaveBeenCalledWith(
      {
        type: 'robot',
        tokenUse: 'refresh',
        sub: 10,
        orgId: 1,
      },
      { expiresIn: '7d' },
    );
  });

  it('accepts Android login without device metadata consent and stores implied consent', async () => {
    prisma.robot.findFirst.mockResolvedValue(buildRobot());
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

  it('rejects an old or unknown license key without issuing a token', async () => {
    prisma.robot.findFirst.mockResolvedValue(null);

    await expect(service.loginRobot({ ...activeLogin, licenseKey: 'WHRB999999' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(prisma.robot.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { licenseKeyFingerprint: licenseFingerprint('WHRB999999') },
          { licenseKey: 'WHRB999999' },
        ],
      },
      include: { org: { select: { isActive: true } } },
    });
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(prisma.robot.update).not.toHaveBeenCalled();
    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'robot.login_failed',
        targetType: 'robot_auth',
        metadata: expect.objectContaining({
          reason: 'INVALID_CREDENTIALS',
          endpoint: 'robot.login',
          ipSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(audit.recordBestEffort.mock.calls[0][0].metadata).not.toHaveProperty('licenseKey');
  });

  it('audits failed user login without storing the password', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.loginUser('admin@example.com', 'wrong-password', { ip: '192.0.2.20' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login_failed',
        targetType: 'user_auth',
        targetId: expect.stringMatching(/^[a-f0-9]{64}$/),
        metadata: expect.objectContaining({
          reason: 'INVALID_CREDENTIALS',
          endpoint: 'user.login',
          ipSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(audit.recordBestEffort.mock.calls[0][0].metadata).not.toHaveProperty('password');
  });

  it('rejects a stolen license key when the serial number does not match', async () => {
    prisma.robot.findFirst.mockResolvedValue(buildRobot({ serialNumber: 'WR-002' }));

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
    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'robot.login_failed',
        targetId: '10',
        targetOrgId: 1,
        metadata: expect.objectContaining({
          reason: 'SERIAL_MISMATCH',
        }),
      }),
    );
  });

  it('rejects inactive organizations without issuing a token', async () => {
    prisma.robot.findFirst.mockResolvedValue(buildRobot({ org: { isActive: false } }));

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

  it('throttles repeated invalid robot login attempts and audits the throttle once', async () => {
    prisma.robot.findFirst.mockResolvedValue(null);

    for (let i = 0; i < 5; i++) {
      await expect(service.loginRobot({ ...activeLogin, licenseKey: 'WHRB999999' }, { ip: '192.0.2.10' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }

    await expect(
      service.loginRobot({ ...activeLogin, licenseKey: 'WHRB999999' }, { ip: '192.0.2.10' }),
    ).rejects.toMatchObject({
      status: 429,
    });

    expect(audit.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'robot.login_throttled',
        metadata: expect.objectContaining({
          reason: 'RATE_LIMITED',
          endpoint: 'robot.login',
        }),
      }),
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('rejects expired licenses without issuing a token', async () => {
    prisma.robot.findFirst.mockResolvedValue(
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
    prisma.robot.findFirst.mockResolvedValue(
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

  it('renews an access token with a valid robot refresh token', async () => {
    jwt.verify.mockReturnValue({
      type: 'robot',
      tokenUse: 'refresh',
      sub: 10,
      orgId: 1,
    });
    prisma.robot.findUnique.mockResolvedValue(buildRobot());
    prisma.robot.update.mockResolvedValue({});

    const result = await service.refreshRobotToken('refresh-token');

    expect(prisma.robot.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      include: { org: { select: { isActive: true } } },
    });
    expect(result.token).toBe('robot-access-jwt');
    expect(result.accessToken).toBe('robot-access-jwt');
    expect(result.refreshToken).toBeUndefined();
    expect(jwt.sign).toHaveBeenCalledTimes(1);
    expect(jwt.sign).toHaveBeenCalledWith(
      {
        type: 'robot',
        tokenUse: 'access',
        sub: 10,
        orgId: 1,
      },
      { expiresIn: '15m' },
    );
  });

  it('rejects access tokens on the refresh endpoint', async () => {
    jwt.verify.mockReturnValue({
      type: 'robot',
      tokenUse: 'access',
      sub: 10,
      orgId: 1,
    });

    await expect(service.refreshRobotToken('access-token')).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.robot.findUnique).not.toHaveBeenCalled();
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('rejects refresh when the organization is inactive', async () => {
    jwt.verify.mockReturnValue({
      type: 'robot',
      tokenUse: 'refresh',
      sub: 10,
      orgId: 1,
    });
    prisma.robot.findUnique.mockResolvedValue(buildRobot({ org: { isActive: false } }));

    await expect(service.refreshRobotToken('refresh-token')).rejects.toBeInstanceOf(DomainLockedException);

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
});
