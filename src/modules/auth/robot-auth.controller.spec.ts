import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthService } from './auth.service';
import { RobotAuthController } from './robot-auth.controller';

const robotLoginBody = {
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

describe('RobotAuthController', () => {
  let app: INestApplication;
  const authService = {
    loginRobot: jest.fn(),
    refreshRobotToken: jest.fn(),
  };

  beforeEach(async () => {
    authService.loginRobot.mockReset();
    authService.refreshRobotToken.mockReset();

    const moduleRef = await Test.createTestingModule({
      controllers: [RobotAuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts Android login with license, serial number and device metadata on the v1 login route', async () => {
    authService.loginRobot.mockResolvedValue({
      token: 'robot-access-jwt',
      accessToken: 'robot-access-jwt',
      refreshToken: 'robot-refresh-jwt',
      expiresIn: 900,
      refreshExpiresIn: 604800,
      tokenType: 'Bearer',
      robot: {
        id: 10,
        orgId: 1,
        serialNumber: 'WR-001',
        name: 'Demo Robot',
      },
      license: {
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2027-01-01T00:00:00.000Z',
        status: 'ACTIVE',
        locked: false,
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/robot/auth/login')
      .send(robotLoginBody)
      .expect(201)
      .expect(({ body }) => {
        expect(body.token).toBe('robot-access-jwt');
        expect(body.accessToken).toBe('robot-access-jwt');
        expect(body.refreshToken).toBe('robot-refresh-jwt');
        expect(body.expiresIn).toBe(900);
        expect(body.license.licenseKey).toBeUndefined();
      });

    expect(authService.loginRobot).toHaveBeenCalledWith(
      robotLoginBody,
      expect.objectContaining({ ip: expect.any(String) }),
    );
  });

  it('accepts Android login without device metadata consent', async () => {
    authService.loginRobot.mockResolvedValue({
      token: 'robot-access-jwt',
      accessToken: 'robot-access-jwt',
      refreshToken: 'robot-refresh-jwt',
      expiresIn: 900,
      refreshExpiresIn: 604800,
      tokenType: 'Bearer',
      robot: {
        id: 10,
        orgId: 1,
        serialNumber: 'WR-001',
        name: 'Demo Robot',
      },
      license: {
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2027-01-01T00:00:00.000Z',
        status: 'ACTIVE',
        locked: false,
      },
    });
    const { deviceMetadataConsent: _omitted, ...androidBody } = robotLoginBody;

    await request(app.getHttpServer()).post('/api/v1/robot/auth/login').send(androidBody).expect(201);

    expect(authService.loginRobot).toHaveBeenCalledWith(
      androidBody,
      expect.objectContaining({ ip: expect.any(String) }),
    );
  });

  it('renews a robot access token on the v1 refresh route', async () => {
    authService.refreshRobotToken.mockResolvedValue({
      token: 'new-robot-access-jwt',
      accessToken: 'new-robot-access-jwt',
      expiresIn: 900,
      tokenType: 'Bearer',
      robot: {
        id: 10,
        orgId: 1,
        serialNumber: 'WR-001',
        name: 'Demo Robot',
      },
      license: {
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2027-01-01T00:00:00.000Z',
        status: 'ACTIVE',
        locked: false,
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/robot/auth/refresh')
      .send({ refreshToken: 'robot-refresh-jwt' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.accessToken).toBe('new-robot-access-jwt');
        expect(body.refreshToken).toBeUndefined();
      });

    expect(authService.refreshRobotToken).toHaveBeenCalledWith('robot-refresh-jwt');
  });

  it('rejects refresh requests without a refresh token', async () => {
    await request(app.getHttpServer()).post('/api/v1/robot/auth/refresh').send({}).expect(400);

    expect(authService.refreshRobotToken).not.toHaveBeenCalled();
  });

  it('rejects login without serial number and device metadata', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/robot/auth/login')
      .send({ licenseKey: 'WHRB000001' })
      .expect(400);

    expect(authService.loginRobot).not.toHaveBeenCalled();
  });

  it('rejects login when device metadata consent is false', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/robot/auth/login')
      .send({ ...robotLoginBody, deviceMetadataConsent: false })
      .expect(400);

    expect(authService.loginRobot).not.toHaveBeenCalled();
  });

  it('rejects prohibited extra device metadata fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/robot/auth/login')
      .send({
        ...robotLoginBody,
        deviceMetadata: {
          ...robotLoginBody.deviceMetadata,
          ownerEmail: 'student@example.com',
        },
      })
      .expect(400);

    expect(authService.loginRobot).not.toHaveBeenCalled();
  });

  it('rejects invalid serial and license-key formats', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/robot/auth/login')
      .send({
        ...robotLoginBody,
        licenseKey: 'WRONG12345',
        serialNumber: 'WR/001',
      })
      .expect(400);

    expect(authService.loginRobot).not.toHaveBeenCalled();
  });
});
