import { ForbiddenException } from '@nestjs/common';
import { RolesService } from './roles.service';

describe('RolesService permission ceiling', () => {
  const prisma = {
    role: {
      findUnique: jest.fn(),
    },
    permission: {
      findUnique: jest.fn(),
    },
    orgPermission: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    userRole: {
      findFirst: jest.fn(),
    },
    rolePermission: {
      upsert: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects role permission assignment when the permission is outside the organization ceiling', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 20, orgId: 7, name: 'Teacher' });
    prisma.permission.findUnique.mockResolvedValue({ id: 50, key: 'content.delete' });
    prisma.orgPermission.findFirst.mockResolvedValue(null);

    const service = new RolesService(prisma as any);

    await expect(
      service.addPermission(20, 'content.delete', { userId: 10, orgId: 7, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });
});
