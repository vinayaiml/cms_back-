import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ConversationConfigModule } from "../conversation-config/conversation-config.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { AiGatewayController } from "./ai-gateway.controller";
import { AiGatewayService } from "./ai-gateway.service";
import { AiProviderClient } from "./ai-provider.client";
import { AiToolRegistryService } from "./ai-tool-registry.service";

@Module({
  imports: [AuditModule, EntitlementsModule, ConversationConfigModule],
  controllers: [AiGatewayController],
  providers: [AiGatewayService, AiProviderClient, AiToolRegistryService],
})
export class AiGatewayModule {}
