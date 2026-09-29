import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { OrgsController } from "./orgs.controller";
import { OrgsService } from "./orgs.service";

@Module({
  imports: [AuditModule, EntitlementsModule],
  controllers: [OrgsController],
  providers: [OrgsService],
})
export class OrgsModule {}
