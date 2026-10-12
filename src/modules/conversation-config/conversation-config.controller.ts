import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { JwtPayload } from "../../common/auth/jwt.types";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { ConversationConfigService } from "./conversation-config.service";
import {
  UpsertApprovedQaDto,
  UpsertConversationConfigDto,
  UpsertConversationContextDto,
} from "./conversation-config.dto";

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationConfigController {
  constructor(private conversationConfig: ConversationConfigService) {}

  private userActor(actor: JwtPayload) {
    if (actor.type !== "user") {
      throw new ForbiddenException("User token required");
    }
    return {
      userId: actor.sub,
      orgId: actor.orgId,
      isSuperAdmin: actor.isSuperAdmin,
    };
  }

  @Get("orgs/:orgId/conversation-config")
  @RequirePermissions("org.read")
  async getOrgConfig(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
  ) {
    return this.conversationConfig.getOrgConfig(orgId, this.userActor(actor));
  }

  @Put("orgs/:orgId/conversation-config")
  @RequirePermissions("org.update")
  async upsertOrgConfig(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Body() dto: UpsertConversationConfigDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.conversationConfig.upsertOrgConfig(
      orgId,
      dto,
      this.userActor(actor),
      correlationId,
    );
  }

  @Get("robots/:robotId/conversation-config")
  @RequirePermissions("robot.read")
  async getRobotEffectiveConfig(
    @CurrentUser() actor: JwtPayload,
    @Param("robotId", ParseIntPipe) robotId: number,
  ) {
    return this.conversationConfig.getRobotEffectiveConfig(
      robotId,
      this.userActor(actor),
    );
  }

  @Put("robots/:robotId/conversation-config")
  @RequirePermissions("robot.update")
  async upsertRobotConfig(
    @CurrentUser() actor: JwtPayload,
    @Param("robotId", ParseIntPipe) robotId: number,
    @Body() dto: UpsertConversationConfigDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.conversationConfig.upsertRobotConfig(
      robotId,
      dto,
      this.userActor(actor),
      correlationId,
    );
  }

  @Get("orgs/:orgId/conversation-context")
  @RequirePermissions("org.read")
  async listOrgContext(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
  ) {
    return this.conversationConfig.listOrgContext(orgId, this.userActor(actor));
  }

  @Put("orgs/:orgId/conversation-context")
  @RequirePermissions("org.update")
  async upsertOrgContext(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Body() dto: UpsertConversationContextDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.conversationConfig.upsertOrgContext(
      orgId,
      dto,
      this.userActor(actor),
      correlationId,
    );
  }

  @Get("orgs/:orgId/approved-qa")
  @RequirePermissions("org.read")
  async listApprovedQa(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
  ) {
    return this.conversationConfig.listApprovedQa(orgId, this.userActor(actor));
  }

  @Put("orgs/:orgId/approved-qa")
  @RequirePermissions("org.update")
  async upsertApprovedQa(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Body() dto: UpsertApprovedQaDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.conversationConfig.upsertApprovedQa(
      orgId,
      dto,
      this.userActor(actor),
      correlationId,
    );
  }

  @Get("orgs/:orgId/conversation-publications")
  @RequirePermissions("org.read")
  async listPublicationRevisions(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
  ) {
    return this.conversationConfig.listPublicationRevisions(
      orgId,
      this.userActor(actor),
    );
  }

  @Put("orgs/:orgId/conversation-publications/:revisionId/restore")
  @RequirePermissions("org.update")
  async restorePublicationRevision(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Param("revisionId", ParseIntPipe) revisionId: number,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.conversationConfig.restorePublicationRevision(
      orgId,
      revisionId,
      this.userActor(actor),
      correlationId,
    );
  }
}
