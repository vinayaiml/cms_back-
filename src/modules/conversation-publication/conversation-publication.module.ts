import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { ConversationPublicationController } from "./conversation-publication.controller";
import { ConversationPublicationService } from "./conversation-publication.service";

@Module({
  imports: [AuditModule],
  controllers: [ConversationPublicationController],
  providers: [ConversationPublicationService],
  exports: [ConversationPublicationService],
})
export class ConversationPublicationModule {}
