import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt.types';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

const superAdmin: JwtPayload = {
  type: 'user',
  sub: 1,
  orgId: null,
  isSuperAdmin: true,
};

const orgAdmin: JwtPayload = {
  type: 'user',
  sub: 2,
  orgId: 10,
  isSuperAdmin: false,
};

const robotActor: JwtPayload = {
  type: 'robot',
  tokenUse: 'access',
  sub: 7,
  orgId: 10,
};

const safeOrg = {
  id: 10,
  name: 'Demo Org',
  state: 'Maharashtra',
  city: 'Mumbai',
  authorizedPersonName: 'Demo Admin',
  contactNo: '9876543210',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('OrgsController tenant isolation', () => {
  let app: INestApplication;
  let currentActor: JwtPayload = superAdmin;

  const orgsService = {
    listAll: jest.fn(),
    create: jest.fn(),
    getMyOrg: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    toggleActive: jest.fn(),
    listPermissions: jest.fn(),
    setPermissions: jest.fn(),
    getSubscription: jest.fn(),
    assignSubscription: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    currentActor = superAdmin;

    const moduleRef = await Test.createTestingModule({
      controllers: [OrgsController],
      providers: [{ provide: OrgsService, useValue: orgsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = currentActor;
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

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

  it('returns safe organization data for Super Admin list requests', async () => {
    orgsService.listAll.mockResolvedValue([safeOrg]);

    await request(app.getHttpServer())
      .get('/api/orgs')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual([safeOrg]);
        expect(JSON.stringify(body)).not.toMatch(/password|token|licenseKey|secret/i);
      });
  });

  it('rejects credential-like fields on organization creation before service code runs', async () => {
    await request(app.getHttpServer())
      .post('/api/orgs')
      .send({
        name: 'New Org',
        state: 'Maharashtra',
        city: 'Mumbai',
        authorizedPersonName: 'Admin',
        contactNo: '9876543210',
        email: 'admin@example.com',
        password: 'should-not-be-accepted',
        adminPassword: 'should-not-be-accepted',
      })
      .expect(400);

    expect(orgsService.create).not.toHaveBeenCalled();
  });

  it('blocks organization admins from direct-ID organization reads', async () => {
    currentActor = orgAdmin;

    await request(app.getHttpServer()).get('/api/orgs/99').expect(403);

    expect(orgsService.getById).not.toHaveBeenCalled();
  });

  it('blocks organization admins from direct-ID organization updates', async () => {
    currentActor = orgAdmin;

    await request(app.getHttpServer())
      .put('/api/orgs/99')
      .send({
        name: 'Other Org',
        state: 'Maharashtra',
        city: 'Mumbai',
        authorizedPersonName: 'Other Admin',
        contactNo: '9876543210',
      })
      .expect(403);

    expect(orgsService.update).not.toHaveBeenCalled();
  });

  it('blocks organization admins from direct-ID deletes and active-state changes', async () => {
    currentActor = orgAdmin;

    await request(app.getHttpServer()).delete('/api/orgs/99').expect(403);
    await request(app.getHttpServer()).patch('/api/orgs/99/toggle-active').expect(403);

    expect(orgsService.delete).not.toHaveBeenCalled();
    expect(orgsService.toggleActive).not.toHaveBeenCalled();
  });

  it('allows Super Admin to assign organization subscription', async () => {
    orgsService.assignSubscription.mockResolvedValue({
      id: 1,
      orgId: 10,
      planId: 2,
      status: 'ACTIVE',
    });

    await request(app.getHttpServer())
      .put('/api/orgs/10/subscription')
      .set('x-correlation-id', 'cms-47-test')
      .send({
        planId: 2,
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: '2027-09-01T00:00:00.000Z',
      })
      .expect(200);

    expect(orgsService.assignSubscription).toHaveBeenCalledWith(
      10,
      {
        planId: 2,
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: '2027-09-01T00:00:00.000Z',
      },
      { userId: 1, orgId: null, isSuperAdmin: true },
      'cms-47-test',
    );
  });

  it('blocks organization users from direct-ID subscription assignment', async () => {
    currentActor = orgAdmin;

    await request(app.getHttpServer())
      .put('/api/orgs/99/subscription')
      .send({
        planId: 2,
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: '2027-09-01T00:00:00.000Z',
      })
      .expect(403);

    expect(orgsService.assignSubscription).not.toHaveBeenCalled();
  });

  it('blocks organization users from direct-ID subscription reads', async () => {
    currentActor = orgAdmin;

    await request(app.getHttpServer()).get('/api/orgs/99/subscription').expect(403);

    expect(orgsService.getSubscription).not.toHaveBeenCalled();
  });

  it('blocks robot tokens from organization administration routes', async () => {
    currentActor = robotActor;

    await request(app.getHttpServer()).get('/api/orgs').expect(403);

    expect(orgsService.listAll).not.toHaveBeenCalled();
  });
});
