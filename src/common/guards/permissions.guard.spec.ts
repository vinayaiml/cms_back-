import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionsGuard } from "./permissions.guard";
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from "../decorators/permissions.decorator";

function buildContext() {
  const handler = {};
  const controller = {};
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          type: "user",
          sub: 10,
          orgId: 7,
          isSuperAdmin: false,
        },
      }),
    }),
  } as any;
}

describe("PermissionsGuard organization ceiling", () => {
  it("does not allow stale permissions that exceed the organization ceiling", async () => {
    const reflector = {
      getAllAndOverride: jest.fn((key) =>
        key === PERMISSIONS_KEY ? ["content.delete"] : undefined,
      ),
    } as unknown as Reflector;
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          directPermissions: [{ permission: { key: "content.delete" } }],
          roles: [
            {
              role: {
                permissions: [{ permission: { key: "content.delete" } }],
              },
            },
          ],
        }),
      },
      orgPermission: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ permission: { key: "content.read" } }]),
      },
    };

    const guard = new PermissionsGuard(reflector, prisma as any);

    await expect(guard.canActivate(buildContext())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("allows access when any required permission is inside the organization ceiling", async () => {
    const reflector = {
      getAllAndOverride: jest.fn((key) =>
        key === ANY_PERMISSIONS_KEY
          ? ["capability.read", "subscription.read"]
          : undefined,
      ),
    } as unknown as Reflector;
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          directPermissions: [{ permission: { key: "capability.read" } }],
          roles: [],
        }),
      },
      orgPermission: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ permission: { key: "capability.read" } }]),
      },
    };

    const guard = new PermissionsGuard(reflector, prisma as any);

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });
});
