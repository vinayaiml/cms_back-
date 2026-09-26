import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { UsersService } from "./users.service";

const entitlements = {
  resolve: jest.fn(),
  resolveCapabilityKeys: jest.fn(),
};

describe("UsersService lock management", () => {
  const tx = {
    user: {
      update: jest.fn(),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = {
    recordCritical: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(tx));
  });

  it("locks a same-tenant user and records a sanitized audit event", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 7,
      createdByUserId: 10,
      isLocked: false,
    });
    tx.user.update.mockResolvedValue({ id: 20, orgId: 7, isLocked: true });

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );
    const result = await service.setLock(20, true, {
      userId: 10,
      orgId: 7,
      isSuperAdmin: false,
    });

    expect(result).toEqual({ ok: true, isLocked: true });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { isLocked: true },
      select: { id: true, orgId: true, isLocked: true },
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 10, orgId: 7, isSuperAdmin: false },
        action: "user.locked",
        targetType: "user",
        targetId: 20,
        targetOrgId: 7,
        metadata: {
          previousStatus: "unlocked",
          newStatus: "locked",
        },
      },
      tx,
    );
    expect(audit.recordCritical.mock.calls[0][0].metadata).not.toHaveProperty(
      "password",
    );
    expect(audit.recordCritical.mock.calls[0][0].metadata).not.toHaveProperty(
      "token",
    );
  });

  it("unlocks a user and records the unlock action", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 7,
      createdByUserId: 10,
      isLocked: true,
    });
    tx.user.update.mockResolvedValue({ id: 20, orgId: 7, isLocked: false });

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );
    const result = await service.setLock(20, false, {
      userId: 10,
      orgId: 7,
      isSuperAdmin: false,
    });

    expect(result).toEqual({ ok: true, isLocked: false });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.unlocked",
        metadata: {
          previousStatus: "locked",
          newStatus: "unlocked",
        },
      }),
      tx,
    );
  });

  it("blocks cross-tenant direct-ID lock attempts", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 8,
      createdByUserId: 10,
      isLocked: false,
    });

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.setLock(20, true, { userId: 10, orgId: 7, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it("blocks self-lock attempts", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 10,
      orgId: 7,
      createdByUserId: 10,
      isLocked: false,
    });

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.setLock(10, true, { userId: 10, orgId: 7, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("returns not found for unknown users", async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.setLock(999, true, {
        userId: 1,
        orgId: null,
        isSuperAdmin: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("UsersService permission ceiling", () => {
  const tx = {
    userPermission: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    role: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    permission: {
      findMany: jest.fn(),
    },
    orgPermission: {
      findMany: jest.fn(),
    },
    userRole: {
      upsert: jest.fn(),
    },
    userPermission: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = {
    recordCritical: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(tx));
  });

  it("rejects direct user permissions outside the target organization ceiling even with permission.manage", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 7,
      createdByUserId: 10,
    });
    prisma.permission.findMany.mockResolvedValue([
      { id: 50, key: "content.delete" },
    ]);
    prisma.orgPermission.findMany.mockResolvedValue([
      { permission: { key: "permission.manage" } },
    ]);

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.setDirectPermissions(20, ["content.delete"], {
        userId: 10,
        orgId: 7,
        isSuperAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.userPermission.deleteMany).not.toHaveBeenCalled();
    expect(tx.userPermission.createMany).not.toHaveBeenCalled();
  });

  it("rejects direct-ID role assignment across tenant boundaries before mutation", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 7,
      createdByUserId: 10,
    });
    prisma.role.findUnique.mockResolvedValue({
      id: 30,
      orgId: 8,
      name: "Teacher",
      permissions: [],
    });

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.assignRole(20, 30, {
        userId: 1,
        orgId: null,
        isSuperAdmin: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.userRole.upsert).not.toHaveBeenCalled();
  });

  it("rejects role assignment when the role contains permissions outside the user organization ceiling", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 7,
      createdByUserId: 10,
    });
    prisma.role.findUnique.mockResolvedValue({
      id: 30,
      orgId: 7,
      name: "Teacher",
      permissions: [{ permission: { key: "content.delete" } }],
    });
    prisma.orgPermission.findMany.mockResolvedValue([
      { permission: { key: "content.read" } },
    ]);

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.assignRole(20, 30, { userId: 10, orgId: 7, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.userRole.upsert).not.toHaveBeenCalled();
  });
});

describe("UsersService capability assignments", () => {
  const tx = {
    userCapabilityAssignment: {
      upsert: jest.fn(),
    },
    organization: {
      update: jest.fn(),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    capability: {
      findUnique: jest.fn(),
    },
    organizationSubscription: {
      findFirst: jest.fn(),
    },
    organizationCapabilityOverride: {
      findMany: jest.fn(),
    },
    userCapabilityAssignment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = {
    recordCritical: jest.fn(),
  };

  const activeUser = {
    id: 20,
    orgId: 7,
    createdByUserId: 10,
    isLocked: false,
    org: { isActive: true },
  };

  const audioCapability = {
    id: 1,
    stableKey: "audio.speaker",
    name: "Speaker Output",
    description: null,
    category: "audio",
    version: 1,
    requiredHardware: null,
    isActive: true,
  };

  const displayCapability = {
    id: 2,
    stableKey: "display.touch",
    name: "Touch Display",
    description: null,
    category: "display",
    version: 1,
    requiredHardware: null,
    isActive: true,
  };

  const cameraCapability = {
    id: 3,
    stableKey: "camera.capture",
    name: "Camera Capture",
    description: null,
    category: "vision",
    version: 1,
    requiredHardware: null,
    isActive: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(tx));
    prisma.user.findUnique.mockResolvedValue(activeUser);
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        isActive: true,
        capabilities: [
          { capability: audioCapability },
          { capability: displayCapability },
        ],
      },
    });
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([
      { effect: "DENY", capability: displayCapability },
      { effect: "ALLOW", capability: cameraCapability },
    ]);
    entitlements.resolve.mockResolvedValue({
      subscription: { status: "ACTIVE" },
      paidCapabilities: [
        { ...audioCapability, limits: { maxVolume: 80 } },
        { ...cameraCapability, limits: { maxPhotos: 5 } },
      ],
    });
    entitlements.resolveCapabilityKeys.mockResolvedValue(
      new Set(["audio.speaker", "camera.capture"]),
    );
  });

  it("returns the intersection of user assignments and organization effective capabilities", async () => {
    prisma.userCapabilityAssignment.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 20,
        capabilityId: 1,
        isEnabled: true,
        limits: { maxVolume: 80 },
        createdByUserId: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        capability: audioCapability,
      },
      {
        id: 2,
        userId: 20,
        capabilityId: 2,
        isEnabled: true,
        limits: null,
        createdByUserId: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        capability: displayCapability,
      },
      {
        id: 3,
        userId: 20,
        capabilityId: 3,
        isEnabled: true,
        limits: { maxPhotos: 5 },
        createdByUserId: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        capability: cameraCapability,
      },
      {
        id: 4,
        userId: 20,
        capabilityId: 4,
        isEnabled: false,
        limits: null,
        createdByUserId: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        capability: {
          ...cameraCapability,
          id: 4,
          stableKey: "inactive.assignment",
        },
      },
    ]);

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );
    const result = await service.getEffectiveCapabilities(20, {
      orgId: 7,
      isSuperAdmin: false,
    });

    expect(result).toEqual({
      userId: 20,
      orgId: 7,
      capabilities: [
        expect.objectContaining({
          stableKey: "audio.speaker",
          limits: { maxVolume: 80 },
        }),
        expect.objectContaining({
          stableKey: "camera.capture",
          limits: { maxPhotos: 5 },
        }),
      ],
    });
    expect(
      result.capabilities.map((capability: any) => capability.stableKey),
    ).not.toContain("display.touch");
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("upserts a user capability assignment with sanitized audit metadata", async () => {
    const assignment = {
      id: 9,
      userId: 20,
      capabilityId: 1,
      isEnabled: true,
      limits: { maxVolume: 80 },
      createdByUserId: 1,
      createdAt: new Date("2026-09-25T12:00:00.000Z"),
      updatedAt: new Date("2026-09-25T12:00:00.000Z"),
      capability: audioCapability,
      user: { orgId: 7 },
    };
    prisma.capability.findUnique.mockResolvedValue(audioCapability);
    prisma.userCapabilityAssignment.findUnique.mockResolvedValue(null);
    tx.userCapabilityAssignment.upsert.mockResolvedValue(assignment);
    tx.organization.update.mockResolvedValue({ id: 7 });

    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );
    const result = await service.upsertCapabilityAssignment(
      20,
      {
        capabilityStableKey: "audio.speaker",
        isEnabled: true,
        limits: { maxVolume: 80 },
      },
      { userId: 1, orgId: null, isSuperAdmin: true },
      "user-cap-123",
    );

    expect(tx.userCapabilityAssignment.upsert).toHaveBeenCalledWith({
      where: { userId_capabilityId: { userId: 20, capabilityId: 1 } },
      create: {
        userId: 20,
        capabilityId: 1,
        isEnabled: true,
        limits: { maxVolume: 80 },
        createdByUserId: 1,
      },
      update: { isEnabled: true, limits: { maxVolume: 80 } },
      include: { capability: true, user: { select: { orgId: true } } },
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.capability_assignment.upserted",
        targetType: "user",
        targetId: 20,
        targetOrgId: 7,
        correlationId: "user-cap-123",
        metadata: expect.objectContaining({
          capabilityStableKey: "audio.speaker",
          next: { isEnabled: true, limits: { maxVolume: 80 } },
        }),
      }),
      tx,
    );
    expect(result).toEqual(
      expect.objectContaining({
        userId: 20,
        orgId: 7,
        capabilityStableKey: "audio.speaker",
        limits: { maxVolume: 80 },
      }),
    );
  });

  it("rejects prohibited limit keys before mutation", async () => {
    prisma.capability.findUnique.mockResolvedValue(audioCapability);
    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.upsertCapabilityAssignment(
        20,
        {
          capabilityStableKey: "audio.speaker",
          limits: { refreshToken: "secret" },
        },
        { userId: 10, orgId: 7, isSuperAdmin: false },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant user capability assignment before capability lookup", async () => {
    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.upsertCapabilityAssignment(
        20,
        { capabilityStableKey: "audio.speaker", limits: { maxVolume: 80 } },
        { userId: 2, orgId: 8, isSuperAdmin: false },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.capability.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
