import { Module } from "@nestjs/common";
import {
  RobotDeviceProfileController,
  RobotSyncController,
} from "./robot-sync.controller";
import { RobotSyncService } from "./robot-sync.service";
import { RobotManifestResolver } from "./robot-manifest.resolver";
import { EntitlementsModule } from "../entitlements/entitlements.module";

@Module({
  imports: [EntitlementsModule],
  controllers: [RobotSyncController, RobotDeviceProfileController],
  providers: [RobotSyncService, RobotManifestResolver],
})
export class RobotSyncModule {}
