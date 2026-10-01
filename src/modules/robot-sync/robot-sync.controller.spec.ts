import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  RobotDeviceProfileController,
  RobotSyncController,
} from "./robot-sync.controller";
import { RobotSyncService } from "./robot-sync.service";

describe("RobotSyncController heartbeat headers", () => {
  const syncService = {
    sync: jest.fn(),
    updateDeviceProfile: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    syncService.sync.mockResolvedValue({ locked: false });
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
    );

    expect(syncService.sync).toHaveBeenCalledWith(10, {
      appVersion: "0.1.0",
      deviceModel: "Mini ELF",
    });
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
