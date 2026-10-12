import { Module } from "@nestjs/common";
import { RobotsController } from "./robots.controller";
import { RobotsService } from "./robots.service";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { RobotManifestResolver } from "../robot-sync/robot-manifest.resolver";
import { ConversationConfigModule } from "../conversation-config/conversation-config.module";
import { IdentityModule } from "../identity/identity.module";

@Module({
  imports: [AuditModule, EntitlementsModule, ConversationConfigModule, IdentityModule],
  controllers: [RobotsController],
  providers: [RobotsService, RobotManifestResolver],
})
export class RobotsModule {}
