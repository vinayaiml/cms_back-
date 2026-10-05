import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  RobotDeviceProfileController,
  RobotSyncController,
} from "./robot-sync.controller";
import { RobotSyncService } from "./robot-sync.service";

describe("RobotSyncController heartbeat headers", () => {
  const syncService = {
    sync: jest.fn(),
    syncChanges: jest.fn(),
    updateDeviceProfile: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    syncService.sync.mockResolvedValue({
      locked: false,
      sync: { manifestHash: "a".repeat(64) },
    });
    syncService.syncChanges.mockResolvedValue({
      schemaVersion: 1,
      manifestVersion: "1.0.0",
      currentManifestHash: "b".repeat(64),
      requiresFullSync: false,
      changed: {},
    });
    syncService.updateDeviceProfile.mockResolvedValue({ robot: { id: 10 } });
  });

  it("passes validated app version and device model headers to sync service", async () => {
    const controller = new RobotSyncController(
      syncService as unknown as RobotSyncService,
    );

    await controller.sync(
      { type: "robot", tokenUse: "access", sub: 10, orgId: 1 },
      "0.1.0",
      "Mini ELF",
      "2",
    );

    expect(syncService.sync).toHaveBeenCalledWith(10, {
      appVersion: "0.1.0",
      deviceModel: "Mini ELF",
      appVersionCode: 2,
    });
  });

  it("returns not modified when If-None-Match matches the manifest hash", async () => {
    const controller = new RobotSyncController(
      syncService as unknown as RobotSyncService,
    );
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    const result = await controller.sync(
      { type: "robot", tokenUse: "access", sub: 10, orgId: 1 },
      undefined,
      undefined,
      undefined,
      `"${"a".repeat(64)}"`,
      response as any,
    );

    expect(result).toBeUndefined();
    expect(response.setHeader).toHaveBeenCalledWith(
      "ETag",
      `"${"a".repeat(64)}"`,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, no-cache",
    );
    expect(response.status).toHaveBeenCalledWith(304);
  });

  it("passes validated incremental version headers to sync changes service", async () => {
    const controller = new RobotSyncController(
      syncService as unknown as RobotSyncService,
    );
    const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis() };

    await controller.changes(
      { type: "robot", tokenUse: "access", sub: 10, orgId: 1 },
      "0.1.0",
      "Mini ELF",
      "2",
      `"${"c".repeat(64)}"`,
      "org-1-v1",
      "1",
      "my-courses-org-1-v1-0",
      "public-catalog-v1-0",
      response as any,
    );

    expect(syncService.syncChanges).toHaveBeenCalledWith(
      10,
      {
        manifestHash: "c".repeat(64),
        cacheVersion: "org-1-v1",
        tenantVersion: 1,
        myCoursesVersion: "my-courses-org-1-v1-0",
        publicCatalogVersion: "public-catalog-v1-0",
      },
      { appVersion: "0.1.0", deviceModel: "Mini ELF", appVersionCode: 2 },
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "ETag",
      `"${"b".repeat(64)}"`,
    );
  });

  it("returns not modified from changes endpoint when If-None-Match matches", async () => {
    const controller = new RobotSyncController(
      syncService as unknown as RobotSyncService,
    );
    const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis() };
    syncService.syncChanges.mockResolvedValue({
      currentManifestHash: "d".repeat(64),
      requiresFullSync: false,
      changed: {},
    });

    const result = await controller.changes(
      { type: "robot", tokenUse: "access", sub: 10, orgId: 1 },
      undefined,
      undefined,
      undefined,
      `"${"d".repeat(64)}"`,
      "org-1-v1",
      "1",
      "my-courses-org-1-v1-0",
      "public-catalog-v1-0",
      response as any,
    );

    expect(result).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(304);
  });

  it("rejects non-robot tokens before sync service access", async () => {
    const controller = new RobotSyncController(
      syncService as unknown as RobotSyncService,
    );

    await expect(
      controller.sync(
        { type: "user", tokenUse: "access", sub: 10, orgId: 1 } as any,
        "0.1.0",
        "Mini ELF",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(syncService.sync).not.toHaveBeenCalled();
  });

  it("rejects invalid app version heartbeat headers", async () => {
    const controller = new RobotSyncController(
      syncService as unknown as RobotSyncService,
    );

    await expect(
      controller.sync(
        { type: "robot", tokenUse: "access", sub: 10, orgId: 1 },
        "0.1.0<secret>",
        "Mini ELF",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(syncService.sync).not.toHaveBeenCalled();
  });

  it("rejects invalid app version code heartbeat headers", async () => {
    const controller = new RobotSyncController(
      syncService as unknown as RobotSyncService,
    );

    await expect(
      controller.sync(
        { type: "robot", tokenUse: "access", sub: 10, orgId: 1 },
        "0.1.0",
        "Mini ELF",
        "2.5",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(syncService.sync).not.toHaveBeenCalled();
  });

  it("passes validated device profile body to the robot profile service", async () => {
    const controller = new RobotDeviceProfileController(
      syncService as unknown as RobotSyncService,
    );
    const body = {
      manufacturer: "Sanbot",
      deviceModel: "Mini ELF",
      androidVersion: "7.1.2",
      apiLevel: 25,
      appVersionName: "0.1.0",
      appVersionCode: 2,
      hardwareProfile: {
        model: "MINI_ELF",
        manufacturer: "Sanbot",
        androidApiLevel: 25,
        abi: "arm64-v8a",
        display: { width: 1920, height: 1200 },
      },
    };

    await controller.updateDeviceProfile(
      { type: "robot", tokenUse: "access", sub: 10, orgId: 1 },
      body,
    );

    expect(syncService.updateDeviceProfile).toHaveBeenCalledWith(10, body);
  });
});
