import { ForbiddenException } from '@nestjs/common';
import { LicenseStatus } from '@prisma/client';
import { RobotsController } from './robots.controller';
import { RobotsService } from './robots.service';

describe('RobotsController fleet filters', () => {
  const robots = {
    listAll: jest.fn(),
    listByOrg: jest.fn(),
    getDetail: jest.fn(),
    listCapabilityAssignments: jest.fn(),
    upsertCapabilityAssignment: jest.fn(),
  };

  let controller: RobotsController;

  beforeEach(() => {
    jest.resetAllMocks();
    robots.listAll.mockResolvedValue([]);
    robots.listByOrg.mockResolvedValue([]);
    robots.getDetail.mockResolvedValue({});
    robots.listCapabilityAssignments.mockResolvedValue([]);
    robots.upsertCapabilityAssignment.mockResolvedValue({});
    controller = new RobotsController(robots as unknown as RobotsService);
  });

  it('passes validated fleet filters for Super Admin', async () => {
    await controller.list(
      { type: 'user', sub: 1, orgId: null, isSuperAdmin: true },
      '2',
      'ACTIVE',
      'MINI_ELF',
      '0.1.0',
      '2026-09-01T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
      '25',
    );

    expect(robots.listAll).toHaveBeenCalledWith({
      orgId: 2,
      status: LicenseStatus.ACTIVE,
      model: 'MINI_ELF',
      version: '0.1.0',
      lastSeenFrom: new Date('2026-09-01T00:00:00.000Z'),
      lastSeenTo: new Date('2026-09-21T00:00:00.000Z'),
      limit: 25,
    });
    expect(robots.listByOrg).not.toHaveBeenCalled();
  });

  it('rejects organization users filtering another tenant before querying', async () => {
    await expect(controller.list({ type: 'user', sub: 2, orgId: 1, isSuperAdmin: false }, '2')).rejects.toBeInstanceOf(ForbiddenException);

    expect(robots.listAll).not.toHaveBeenCalled();
    expect(robots.listByOrg).not.toHaveBeenCalled();
  });

  it('scopes organization users to their own organization with filters', async () => {
    await controller.list({ type: 'user', sub: 2, orgId: 1, isSuperAdmin: false }, undefined, 'EXPIRING_SOON', 'ELF', '1.0.0');

    expect(robots.listByOrg).toHaveBeenCalledWith(1, {
      status: LicenseStatus.EXPIRING_SOON,
      model: 'ELF',
      version: '1.0.0',
      lastSeenFrom: undefined,
      lastSeenTo: undefined,
      limit: undefined,
    });
    expect(robots.listAll).not.toHaveBeenCalled();
  });

  it('passes scoped actor context to robot detail', async () => {
    await controller.detail({ type: 'user', sub: 2, orgId: 1, isSuperAdmin: false }, 10, '25');

    expect(robots.getDetail).toHaveBeenCalledWith(10, { orgId: 1, isSuperAdmin: false }, 25);
  });

  it('passes scoped actor context to robot capability assignment listing', async () => {
    await controller.capabilityAssignments({ type: 'user', sub: 2, orgId: 1, isSuperAdmin: false }, 10);

    expect(robots.listCapabilityAssignments).toHaveBeenCalledWith(10, { orgId: 1, isSuperAdmin: false });
  });

  it('passes correlation id and actor context to robot capability assignment upsert', async () => {
    await controller.upsertCapabilityAssignment(
      { type: 'user', sub: 1, orgId: null, isSuperAdmin: true },
      10,
      { capabilityStableKey: 'audio.speaker', isEnabled: true, limits: { maxVolume: 80 } },
      'cap-assign-123',
    );

    expect(robots.upsertCapabilityAssignment).toHaveBeenCalledWith(
      10,
      { capabilityStableKey: 'audio.speaker', isEnabled: true, limits: { maxVolume: 80 } },
      { userId: 1, orgId: null, isSuperAdmin: true },
      'cap-assign-123',
    );
  });
});
