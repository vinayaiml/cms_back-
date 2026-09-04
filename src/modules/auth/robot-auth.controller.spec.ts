import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthService } from './auth.service';
import { RobotAuthController } from './robot-auth.controller';

const robotLoginBody = {
  licenseKey: 'LICENSE-1-1',
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
  };

  beforeEach(async () => {
    authService.loginRobot.mockReset();

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
      token: 'robot-jwt',
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
        expect(body.token).toBe('robot-jwt');
        expect(body.license.licenseKey).toBeUndefined();
      });

    expect(authService.loginRobot).toHaveBeenCalledWith(robotLoginBody);
  });

  it('accepts Android login without device metadata consent', async () => {
    authService.loginRobot.mockResolvedValue({
      token: 'robot-jwt',
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

    expect(authService.loginRobot).toHaveBeenCalledWith(androidBody);
  });

  it('rejects login without serial number and device metadata', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/robot/auth/login')
      .send({ licenseKey: 'LICENSE-1-1' })
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
        licenseKey: 'LICENSE 1 with spaces',
        serialNumber: 'WR/001',
      })
      .expect(400);

    expect(authService.loginRobot).not.toHaveBeenCalled();
  });
});
