import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { JwtPayload } from "../../common/auth/jwt.types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermissions } from "../../common/decorators/permissions.decorator";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import {
  CreateIdentityEmbeddingDto,
  DeleteIdentityEmbeddingDto,
  RevokeIdentityConsentDto,
  UpdateIdentityEmbeddingDto,
} from "./identity.dto";
import { IdentityService } from "./identity.service";

@Controller("orgs/:orgId/identity-embeddings")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IdentityController {
  constructor(private identity: IdentityService) {}

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

  @Get()
  @RequirePermissions("org.read")
  async list(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
  ) {
    return this.identity.list(orgId, this.userActor(actor));
  }

  @Post()
  @RequirePermissions("org.update")
  async create(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Body() dto: CreateIdentityEmbeddingDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.identity.create(
      orgId,
      dto,
      this.userActor(actor),
      correlationId,
    );
  }

  @Put(":id")
  @RequirePermissions("org.update")
  async correct(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateIdentityEmbeddingDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.identity.correct(
      orgId,
      id,
      dto,
      this.userActor(actor),
      correlationId,
    );
  }

  @Patch(":id")
  @RequirePermissions("org.update")
  async correctPatch(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateIdentityEmbeddingDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.identity.correct(
      orgId,
      id,
      dto,
      this.userActor(actor),
      correlationId,
    );
  }

  @Post(":id/revoke-consent")
  @RequirePermissions("org.update")
  async revokeConsent(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RevokeIdentityConsentDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.identity.revokeConsent(
      orgId,
      id,
      dto ?? {},
      this.userActor(actor),
      correlationId,
    );
  }

  @Put(":id/revoke-consent")
  @RequirePermissions("org.update")
  async revokeConsentPut(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RevokeIdentityConsentDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.identity.revokeConsent(
      orgId,
      id,
      dto ?? {},
      this.userActor(actor),
      correlationId,
    );
  }

  @Delete(":id")
  @RequirePermissions("org.update")
  async erase(
    @CurrentUser() actor: JwtPayload,
    @Param("orgId", ParseIntPipe) orgId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: DeleteIdentityEmbeddingDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return this.identity.erase(
      orgId,
      id,
      dto ?? {},
      this.userActor(actor),
      correlationId,
    );
  }
}
