import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let app: INestApplication;
  const authService = {
    loginUser: jest.fn(),
  };

  beforeEach(async () => {
    authService.loginUser.mockReset();

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
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

  it('returns a user token from the v1 login route', async () => {
    authService.loginUser.mockResolvedValue({
      token: 'test-user-token',
      user: {
        id: 1,
        email: 'admin@example.com',
        fullName: 'Admin User',
        orgId: null,
        isSuperAdmin: true,
      },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'test-password' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.token).toBe('test-user-token');
        expect(body.user.email).toBe('admin@example.com');
      });

    expect(authService.loginUser).toHaveBeenCalledWith(
      'admin@example.com',
      'test-password',
      expect.objectContaining({ ip: expect.any(String) }),
    );
  });

  it('rejects invalid login bodies', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);

    expect(authService.loginUser).not.toHaveBeenCalled();
  });
});
