import { Module } from "@nestjs/common";
import { RobotsController } from "./robots.controller";
import { RobotsService } from "./robots.service";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";

@Module({
  imports: [AuditModule, EntitlementsModule],
  controllers: [RobotsController],
  providers: [RobotsService],
})
export class RobotsModule {}
