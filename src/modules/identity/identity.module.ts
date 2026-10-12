import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { IdentityController, RecognitionModelController } from "./identity.controller";
import { RobotIdentityController } from "./robot-identity.controller";
import { IdentityService } from "./identity.service";

@Module({
  imports: [AuditModule],
  controllers: [IdentityController, RecognitionModelController, RobotIdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
