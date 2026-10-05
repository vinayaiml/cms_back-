import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Put, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RobotOnlyGuard } from '../../common/guards/robot-only.guard';
import { RobotOnly } from '../../common/decorators/robot-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { RobotSyncChangesInput, RobotSyncHeartbeat, RobotSyncService } from './robot-sync.service';
import { RobotDeviceProfileDto } from './robot-device-profile.dto';
import { Response } from 'express';

function optionalHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}


function normalizeEtag(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed === '*') return trimmed;
  return trimmed.replace(/^W\//, '').replace(/^"|"$/g, '');
}

function matchesManifestEtag(header: string | undefined, manifestHash: string) {
  if (!header) return false;
  return header
    .split(',')
    .map((part) => normalizeEtag(part))
    .some((candidate) => candidate === '*' || candidate === manifestHash);
}

function validateOptionalHeader(value: string | undefined, name: string, maxLength: number, pattern: RegExp) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.length > maxLength || !pattern.test(trimmed)) {
    throw new BadRequestException(`${name} is invalid`);
  }

  return trimmed;
}

function validateOptionalIntegerHeader(value: string | undefined, name: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) {
    throw new BadRequestException(`${name} is invalid`);
  }
  return Number(trimmed);
}

function buildHeartbeat(
  appVersionHeader?: string | string[],
  deviceModelHeader?: string | string[],
  appVersionCodeHeader?: string | string[],
) {
  return {
    appVersion: validateOptionalHeader(
      optionalHeader(appVersionHeader),
      'x-robot-app-version',
      40,
      /^[0-9A-Za-z._+-]+$/,
    ),
    deviceModel: validateOptionalHeader(
      optionalHeader(deviceModelHeader),
      'x-robot-device-model',
      80,
      /^[0-9A-Za-z._+() -]+$/,
    ),
    appVersionCode: validateOptionalIntegerHeader(
      optionalHeader(appVersionCodeHeader),
      'x-robot-app-version-code',
    ),
  };
}

function setManifestHeaders(response: Response | undefined, manifestHash: unknown) {
  if (typeof manifestHash !== 'string') return;
  response?.setHeader('ETag', `"${manifestHash}"`);
  response?.setHeader('Cache-Control', 'private, no-cache');
}

@Controller(['robot/sync', 'v1/robot/sync'])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class RobotSyncController {
  constructor(private syncService: RobotSyncService) {}

  @Get()
  async sync(
    @CurrentUser() actor: JwtPayload,
    @Headers('x-robot-app-version') appVersionHeader?: string | string[],
    @Headers('x-robot-device-model') deviceModelHeader?: string | string[],
    @Headers('x-robot-app-version-code') appVersionCodeHeader?: string | string[],
    @Headers('if-none-match') ifNoneMatchHeader?: string | string[],
    @Res({ passthrough: true }) response?: Response,
  ) {
    if (actor.type !== 'robot') throw new ForbiddenException('Robot token required');

    const heartbeat: RobotSyncHeartbeat = buildHeartbeat(
      appVersionHeader,
      deviceModelHeader,
      appVersionCodeHeader,
    );

    const manifest = await this.syncService.sync(actor.sub, heartbeat);
    const manifestHash = (manifest as any)?.sync?.manifestHash;
    setManifestHeaders(response, manifestHash);
    if (
      typeof manifestHash === 'string' &&
      matchesManifestEtag(optionalHeader(ifNoneMatchHeader), manifestHash)
    ) {
      response?.status(304);
      return undefined;
    }

    return manifest;
  }

  @Get('changes')
  async changes(
    @CurrentUser() actor: JwtPayload,
    @Headers('x-robot-app-version') appVersionHeader?: string | string[],
    @Headers('x-robot-device-model') deviceModelHeader?: string | string[],
    @Headers('x-robot-app-version-code') appVersionCodeHeader?: string | string[],
    @Headers('if-none-match') ifNoneMatchHeader?: string | string[],
    @Headers('x-robot-cache-version') cacheVersionHeader?: string | string[],
    @Headers('x-robot-tenant-version') tenantVersionHeader?: string | string[],
    @Headers('x-robot-my-courses-version') myCoursesVersionHeader?: string | string[],
    @Headers('x-robot-public-catalog-version') publicCatalogVersionHeader?: string | string[],
    @Res({ passthrough: true }) response?: Response,
  ) {
    if (actor.type !== 'robot') throw new ForbiddenException('Robot token required');

    const heartbeat: RobotSyncHeartbeat = buildHeartbeat(
      appVersionHeader,
      deviceModelHeader,
      appVersionCodeHeader,
    );
    const clientVersions: RobotSyncChangesInput = {
      manifestHash: normalizeEtag(optionalHeader(ifNoneMatchHeader)),
      cacheVersion: validateOptionalHeader(
        optionalHeader(cacheVersionHeader),
        'x-robot-cache-version',
        120,
        /^[0-9A-Za-z._+-]+$/,
      ),
      tenantVersion: validateOptionalIntegerHeader(
        optionalHeader(tenantVersionHeader),
        'x-robot-tenant-version',
      ),
      myCoursesVersion: validateOptionalHeader(
        optionalHeader(myCoursesVersionHeader),
        'x-robot-my-courses-version',
        120,
        /^[0-9A-Za-z._+-]+$/,
      ),
      publicCatalogVersion: validateOptionalHeader(
        optionalHeader(publicCatalogVersionHeader),
        'x-robot-public-catalog-version',
        120,
        /^[0-9A-Za-z._+-]+$/,
      ),
    };

    const changes = await this.syncService.syncChanges(
      actor.sub,
      clientVersions,
      heartbeat,
    );
    const manifestHash = (changes as any)?.currentManifestHash;
    setManifestHeaders(response, manifestHash);
    if (
      typeof manifestHash === 'string' &&
      matchesManifestEtag(optionalHeader(ifNoneMatchHeader), manifestHash)
    ) {
      response?.status(304);
      return undefined;
    }

    return changes;
  }
}

@Controller(['robot/device-profile', 'v1/robot/device-profile'])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class RobotDeviceProfileController {
  constructor(private syncService: RobotSyncService) {}

  @Put()
  async updateDeviceProfile(
    @CurrentUser() actor: JwtPayload,
    @Body() body: RobotDeviceProfileDto,
  ) {
    if (actor.type !== 'robot') throw new ForbiddenException('Robot token required');

    return this.syncService.updateDeviceProfile(actor.sub, body);
  }
}
