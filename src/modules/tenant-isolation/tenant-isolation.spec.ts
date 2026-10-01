import { ForbiddenException } from "@nestjs/common";
import { LicenseStatus } from "@prisma/client";
import { DomainLockedException } from "../../common/errors/domain-locked.exception";
import { JwtPayload } from "../../common/auth/jwt.types";
import { OrgsController } from "../orgs/orgs.controller";
import { RobotSyncService } from "../robot-sync/robot-sync.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { RobotManifestResolver } from "../robot-sync/robot-manifest.resolver";
import { RobotsController } from "../robots/robots.controller";
import { RolesController } from "../roles/roles.controller";
import { RolesService } from "../roles/roles.service";
import { UsersController } from "../users/users.controller";
import { UsersService } from "../users/users.service";

const orgUser: JwtPayload = {
  type: "user",
  sub: 10,
  orgId: 10,
  isSuperAdmin: false,
};

const entitlements = {
  resolve: jest.fn(),
  resolveCapabilityKeys: jest.fn(),
};

const otherOrgUser = {
  id: 20,
  orgId: 99,
  email: "other-admin@example.test",
  createdByUserId: 30,
  isLocked: false,
};

describe("CMS-37 cross-tenant authorization regression suite", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("does not let organization users read another organization by query override", async () => {
    const usersService = { listUsers: jest.fn().mockResolvedValue([]) };
    const rolesService = { list: jest.fn().mockResolvedValue([]) };

    await new UsersController(usersService as any).list(orgUser, "99");
    await new RolesController(rolesService as any).list(orgUser, "99");

    expect(usersService.listUsers).toHaveBeenCalledWith(10);
    expect(usersService.listUsers).not.toHaveBeenCalledWith(99);
    expect(rolesService.list).toHaveBeenCalledWith(10);
    expect(rolesService.list).not.toHaveBeenCalledWith(99);
  });

  it("rejects direct-ID organization administration attempts before service calls", async () => {
    const orgsService = {
      getById: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      toggleActive: jest.fn(),
      listPermissions: jest.fn(),
      setPermissions: jest.fn(),
    };
    const controller = new OrgsController(orgsService as any);

    await expect(controller.get(orgUser, 99)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.update(orgUser, 99, {
        name: "Other Org",
        state: "Maharashtra",
        city: "Mumbai",
        authorizedPersonName: "Other Admin",
        contactNo: "9876543210",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.delete(orgUser, 99)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.toggleActive(orgUser, 99)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.listPermissions(orgUser, 99),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.setPermissions(orgUser, 99, { permissionKeys: ["user.read"] }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(orgsService.getById).not.toHaveBeenCalled();
    expect(orgsService.update).not.toHaveBeenCalled();
    expect(orgsService.delete).not.toHaveBeenCalled();
    expect(orgsService.toggleActive).not.toHaveBeenCalled();
    expect(orgsService.listPermissions).not.toHaveBeenCalled();
    expect(orgsService.setPermissions).not.toHaveBeenCalled();
  });

  it("rejects direct-ID user updates, deletes, locks and direct permissions across tenants before mutation", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(otherOrgUser),
        update: jest.fn(),
        delete: jest.fn(),
      },
      permission: { findMany: jest.fn() },
      orgPermission: { findMany: jest.fn() },
      userPermission: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const audit = { recordCritical: jest.fn() };
    const service = new UsersService(
      prisma as any,
      audit as any,
      entitlements as any,
    );

    await expect(
      service.updateUser(
        20,
        { fullName: "Other User" },
        { userId: 10, orgId: 10, isSuperAdmin: false },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.deleteUser(20, { userId: 10, orgId: 10, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.setLock(20, true, { userId: 10, orgId: 10, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.setDirectPermissions(20, ["user.read"], {
        userId: 10,
        orgId: 10,
        isSuperAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant role permission mutation before persistence", async () => {
    const prisma = {
      role: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 40, orgId: 99, name: "Other Org Role" }),
      },
      permission: { findUnique: jest.fn() },
      orgPermission: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      userRole: { findFirst: jest.fn() },
      rolePermission: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    const service = new RolesService(prisma as any);

    await expect(
      service.addPermission(40, "user.read", {
        userId: 10,
        orgId: 10,
        isSuperAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.removePermission(40, "user.read", {
        userId: 10,
        orgId: 10,
        isSuperAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.permission.findUnique).not.toHaveBeenCalled();
    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects robot direct-ID lock and renewal attempts across tenants before mutation", async () => {
    const robotsService = {
      getRobotOrThrow: jest.fn().mockResolvedValue({ id: 77, orgId: 99 }),
      ensureOrgAccess: jest.fn().mockImplementation(() => {
        throw new ForbiddenException("Cannot access other org");
      }),
      lockRobot: jest.fn(),
      renewLicense: jest.fn(),
    };
    const controller = new RobotsController(robotsService as any);

    await expect(
      controller.lock(orgUser, 77, { lock: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.renew(orgUser, 77, { validUntil: "2027-01-01T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(robotsService.getRobotOrThrow).toHaveBeenCalledWith(77);
    expect(robotsService.ensureOrgAccess).toHaveBeenCalledWith(
      { orgId: 10, isSuperAdmin: false },
      99,
    );
    expect(robotsService.lockRobot).not.toHaveBeenCalled();
    expect(robotsService.renewLicense).not.toHaveBeenCalled();
  });

  it("rejects inactive organization robot sync and does not return tenant context", async () => {
    const prisma = {
      robot: {
        findUnique: jest.fn().mockResolvedValue({
          id: 77,
          orgId: 99,
          serialNumber: "TEST-INACTIVE-ORG-001",
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validUntil: new Date("2099-01-01T00:00:00.000Z"),
          revokedAt: null,
          licenseStatus: LicenseStatus.ACTIVE,
          org: {
            id: 99,
            name: "Inactive Org",
            isActive: false,
            logoUrl: null,
            primaryColor: null,
            secondaryColor: null,
            tenantVersion: 1,
          },
        }),
        update: jest.fn(),
      },
      event: { create: jest.fn() },
      course: { findMany: jest.fn() },
      orgCourseAccess: { findMany: jest.fn() },
    };
    const service = new RobotSyncService(
      prisma as any,
      new RobotManifestResolver(new EntitlementsService(prisma as any)),
    );

    await expect(service.sync(77)).rejects.toBeInstanceOf(
      DomainLockedException,
    );

    expect(prisma.event.create).toHaveBeenCalledWith({
      data: {
        orgId: 99,
        robotId: 77,
        type: "ROBOT_ACCESS_REJECTED_ORG_INACTIVE",
        payload: {
          reason: "ORG_INACTIVE",
          endpoint: "robot.sync",
        },
      },
    });
    expect(prisma.robot.update).not.toHaveBeenCalled();
    expect(prisma.course.findMany).not.toHaveBeenCalled();
    expect(prisma.orgCourseAccess.findMany).not.toHaveBeenCalled();
  });
});
