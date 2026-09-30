import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { JwtPayload } from "../../common/auth/jwt.types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import {
  RequireAnyPermission,
  RequirePermissions,
} from "../../common/decorators/permissions.decorator";
import { PermissionsGuard } from "../../common/guards/permissions.guard";
import { CapabilitiesService } from "./capabilities.service";
import { CreateCapabilityDto, UpdateCapabilityDto } from "./capabilities.dto";

@Controller("capabilities")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CapabilitiesController {
  constructor(private capabilities: CapabilitiesService) {}

  @Get()
  @RequireAnyPermission("capability.read", "subscription.read")
  async list(
    @CurrentUser() actor: JwtPayload,
    @Query("includeInactive") includeInactive?: string,
  ) {
    if (actor.type !== "user")
      throw new ForbiddenException("User token required");
    const showInactive = actor.isSuperAdmin && includeInactive === "true";
    return this.capabilities.list({ includeInactive: showInactive });
  }

  @Get(":id")
  @RequireAnyPermission("capability.read", "subscription.read")
  async get(
    @CurrentUser() actor: JwtPayload,
    @Param("id", ParseIntPipe) id: number,
    @Query("includeInactive") includeInactive?: string,
  ) {
    if (actor.type !== "user")
      throw new ForbiddenException("User token required");
    const showInactive = actor.isSuperAdmin && includeInactive === "true";
    return this.capabilities.get(id, { includeInactive: showInactive });
  }

  @Post()
  @RequirePermissions("capability.manage")
  async create(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CreateCapabilityDto,
  ) {
    if (actor.type !== "user")
      throw new ForbiddenException("User token required");
    if (!actor.isSuperAdmin) throw new ForbiddenException("Super Admin only");
    return this.capabilities.create(dto);
  }

  @Patch(":id")
  @RequirePermissions("capability.manage")
  async update(
    @CurrentUser() actor: JwtPayload,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateCapabilityDto,
  ) {
    if (actor.type !== "user")
      throw new ForbiddenException("User token required");
    if (!actor.isSuperAdmin) throw new ForbiddenException("Super Admin only");
    return this.capabilities.update(id, dto);
  }

  @Delete(":id")
  @RequirePermissions("capability.manage")
  async disable(
    @CurrentUser() actor: JwtPayload,
    @Param("id", ParseIntPipe) id: number,
  ) {
    if (actor.type !== "user")
      throw new ForbiddenException("User token required");
    if (!actor.isSuperAdmin) throw new ForbiddenException("Super Admin only");
    return this.capabilities.disable(id);
  }
}
