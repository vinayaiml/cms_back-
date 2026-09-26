import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { RobotsService } from './robots.service';
import { CreateRobotDto, LockRobotDto, ReassignRobotDto, RenewLicenseDto, UpsertRobotCapabilityAssignmentDto } from './robots.dto';
import { LicenseStatus } from '@prisma/client';

@Controller('robots')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RobotsController {
  constructor(private robots: RobotsService) {}

  private parsePositiveInt(value?: string) {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException('Invalid robot fleet filter');
    return parsed;
  }

  private parseLicenseStatus(value?: string) {
    if (!value) return undefined;
    if (!Object.values(LicenseStatus).includes(value as LicenseStatus)) {
      throw new BadRequestException('Invalid robot fleet filter');
    }
    return value as LicenseStatus;
  }

  private parseHardwareModel(value?: string) {
    if (!value) return undefined;
    if (!['MINI_ELF', 'ELF', 'NANO', 'S5'].includes(value)) {
      throw new BadRequestException('Invalid robot fleet filter');
    }
    return value;
  }

  private parseSafeString(value?: string) {
    const trimmed = value?.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > 80 || !/^[0-9A-Za-z._+() -]+$/.test(trimmed)) {
      throw new BadRequestException('Invalid robot fleet filter');
    }
    return trimmed;
  }

  private parseDate(value?: string) {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Invalid robot fleet filter');
    return parsed;
  }

  @Get()
  @RequirePermissions('robot.read')
  async list(
    @CurrentUser() actor: JwtPayload,
    @Query('orgId') orgId?: string,
    @Query('status') status?: string,
    @Query('model') model?: string,
    @Query('version') version?: string,
    @Query('lastSeenFrom') lastSeenFrom?: string,
    @Query('lastSeenTo') lastSeenTo?: string,
    @Query('limit') limit?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    const requestedOrgId = this.parsePositiveInt(orgId);
    const filters = {
      status: this.parseLicenseStatus(status),
      model: this.parseHardwareModel(model),
      version: this.parseSafeString(version),
      lastSeenFrom: this.parseDate(lastSeenFrom),
      lastSeenTo: this.parseDate(lastSeenTo),
      limit: this.parsePositiveInt(limit),
    };

    if (actor.isSuperAdmin) {
      return this.robots.listAll({ ...filters, orgId: requestedOrgId });
    }

    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    if (requestedOrgId !== undefined && requestedOrgId !== actor.orgId) {
      throw new ForbiddenException('Cannot access other org');
    }
    return this.robots.listByOrg(actor.orgId, filters);
  }

  @Post()
  @RequirePermissions('robot.create')
  async create(@CurrentUser() actor: JwtPayload, @Body() dto: CreateRobotDto, @Headers('x-correlation-id') correlationId?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    const effectiveOrgId = actor.isSuperAdmin ? dto.orgId : actor.orgId;
    if (!effectiveOrgId) throw new ForbiddenException('Org scope required');
    return this.robots.createRobot(
      {
        orgId: effectiveOrgId,
        serialNumber: dto.serialNumber,
        name: dto.name,
        validFrom: new Date(dto.validFrom),
        validUntil: new Date(dto.validUntil),
        hardwareProfile: dto.hardwareProfile,
      },
      { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin },
      correlationId,
    );
  }

  @Get(':id')
  @RequirePermissions('robot.read')
  async detail(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Query('limit') limit?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.getDetail(id, { orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, limit ? Number(limit) : undefined);
  }

  @Put(':id/license/renew')
  @RequirePermissions('license.renew')
  async renew(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: RenewLicenseDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    const robot = await this.robots.getRobotOrThrow(id);
    await this.robots.ensureOrgAccess({ orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, robot.orgId);

    return this.robots.renewLicense(id, new Date(dto.validUntil));
  }

  @Post(':id/credentials/rotate')
  @RequirePermissions('license.renew')
  async rotateCredential(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Headers('x-correlation-id') correlationId?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.rotateCredential(id, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, correlationId);
  }

  @Post(':id/credentials/revoke')
  @RequirePermissions('robot.lock')
  async revokeCredential(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Headers('x-correlation-id') correlationId?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.revokeCredential(id, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, correlationId);
  }

  @Put(':id/lock')
  @RequirePermissions('robot.lock')
  async lock(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: LockRobotDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    const robot = await this.robots.getRobotOrThrow(id);
    await this.robots.ensureOrgAccess({ orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, robot.orgId);

    return this.robots.lockRobot(id, !!dto.lock);
  }

  @Patch(':id/reassign')
  @RequirePermissions('robot.update')
  async reassign(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: ReassignRobotDto, @Headers('x-correlation-id') correlationId?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.reassignRobot(id, dto.orgId, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, correlationId);
  }

  @Get(':id/capability-assignments')
  @RequirePermissions('robot.read')
  async capabilityAssignments(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.listCapabilityAssignments(id, { orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }

  @Put(':id/capability-assignments')
  @RequirePermissions('robot.update')
  async upsertCapabilityAssignment(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertRobotCapabilityAssignmentDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.upsertCapabilityAssignment(id, dto, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, correlationId);
  }

  @Get(':id/reassignment-history')
  @RequirePermissions('robot.read')
  async reassignmentHistory(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Query('limit') limit?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.listReassignmentHistory(id, { orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, limit ? Number(limit) : undefined);
  }

  // Backward-compatibility for clients that still call GET /robots/:id/lock
  // lock defaults to true; pass ?lock=false to unlock.
  @Get(':id/lock')
  @RequirePermissions('robot.lock')
  async lockCompat(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Query('lock') lock?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    const robot = await this.robots.getRobotOrThrow(id);
    await this.robots.ensureOrgAccess({ orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, robot.orgId);

    const shouldLock = lock === undefined ? true : !['0', 'false', 'no', 'n'].includes(lock.toLowerCase());
    return this.robots.lockRobot(id, shouldLock);
  }

  @Delete(':id/device-metadata')
  @RequirePermissions('robot.update')
  async clearDeviceMetadata(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Headers('x-correlation-id') correlationId?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.clearDeviceMetadata(id, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin }, correlationId);
  }
}
