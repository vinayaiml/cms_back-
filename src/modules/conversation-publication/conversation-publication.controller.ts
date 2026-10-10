import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { JwtPayload } from "../../common/auth/jwt.types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { AuditActor } from "../audit/audit.types";
import { ConversationPublicationService } from "./conversation-publication.service";

function toActor(user: JwtPayload): AuditActor {
  if (user.type !== "user") {
    throw new ForbiddenException("User token required");
  }
  return {
    userId: user.sub,
    orgId: user.orgId,
    isSuperAdmin: user.isSuperAdmin,
  };
}

@Controller(["orgs", "v1/orgs"])
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationPublicationController {
  constructor(private publications: ConversationPublicationService) {}

  @Get(":orgId/conversation-publications")
  @RequirePermissions("org.read")
  async list(
    @Param("orgId", ParseIntPipe) orgId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.publications.list(orgId, toActor(user));
  }

  @Put(":orgId/conversation-publications/:revisionId/restore")
  @RequirePermissions("org.update")
  async restore(
    @Param("orgId", ParseIntPipe) orgId: number,
    @Param("revisionId", ParseIntPipe) revisionId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.publications.restore(orgId, revisionId, toActor(user));
  }
}
