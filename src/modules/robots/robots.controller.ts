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
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { RobotsService } from './robots.service';
import { CreateRobotDto, LockRobotDto, ReassignRobotDto, RenewLicenseDto } from './robots.dto';

@Controller('robots')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RobotsController {
  constructor(private robots: RobotsService) {}

  @Get()
  @RequirePermissions('robot.read')
  async list(@CurrentUser() actor: JwtPayload, @Query('orgId') orgId?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    if (actor.isSuperAdmin) {
      const parsedOrgId = orgId ? Number(orgId) : undefined;
      return this.robots.listAll(parsedOrgId);
    }

    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    return this.robots.listByOrg(actor.orgId);
  }

  @Post()
  @RequirePermissions('robot.create')
  async create(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CreateRobotDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
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
  async rotateCredential(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.rotateCredential(
      id,
      { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin },
      correlationId,
    );
  }

  @Post(':id/credentials/revoke')
  @RequirePermissions('robot.lock')
  async revokeCredential(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.revokeCredential(
      id,
      { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin },
      correlationId,
    );
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
  async reassign(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReassignRobotDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.reassignRobot(
      id,
      dto.orgId,
      { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin },
      correlationId,
    );
  }

  @Get(':id/reassignment-history')
  @RequirePermissions('robot.read')
  async reassignmentHistory(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.listReassignmentHistory(
      id,
      { orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin },
      limit ? Number(limit) : undefined,
    );
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
  async clearDeviceMetadata(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.robots.clearDeviceMetadata(
      id,
      { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin },
      correlationId,
    );
  }
}
