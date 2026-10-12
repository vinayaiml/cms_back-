import { Module } from "@nestjs/common";
import {
  RobotDeviceProfileController,
  RobotSyncController,
} from "./robot-sync.controller";
import { RobotSyncService } from "./robot-sync.service";
import { RobotManifestResolver } from "./robot-manifest.resolver";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { ContentDeliveryModule } from "../content-delivery/content-delivery.module";
import { ConversationConfigModule } from "../conversation-config/conversation-config.module";
import { IdentityModule } from "../identity/identity.module";

@Module({
  imports: [
    EntitlementsModule,
    ContentDeliveryModule,
    ConversationConfigModule,
    IdentityModule,
  ],
  controllers: [RobotSyncController, RobotDeviceProfileController],
  providers: [RobotSyncService, RobotManifestResolver],
})
export class RobotSyncModule {}
