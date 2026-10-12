import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ConversationConfigController } from "./conversation-config.controller";
import { ConversationConfigService } from "./conversation-config.service";

@Module({
  imports: [AuditModule],
  controllers: [ConversationConfigController],
  providers: [ConversationConfigService],
  exports: [ConversationConfigService],
})
export class ConversationConfigModule {}
