import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { JwtPayload } from "../../common/auth/jwt.types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RobotOnly } from "../../common/decorators/robot-only.decorator";
import { RobotOnlyGuard } from "../../common/guards/robot-only.guard";
import {
  RobotIdentityEnrollmentDto,
  RobotIdentityFeedbackDto,
  RobotIdentityTemplateDto,
} from "./identity.dto";
import { IdentityService } from "./identity.service";

@Controller(["v1/robot/identity", "robot/identity"])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class RobotIdentityController {
  private readonly enrollmentBuckets = new Map<
    string,
    { count: number; startedAt: number }
  >();

  constructor(private identity: IdentityService) {}

  @Post("enrollments")
  async enroll(
    @CurrentUser() actor: JwtPayload,
    @Body() body: RobotIdentityEnrollmentDto,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    if (actor.type !== "robot") throw new ForbiddenException("Robot token required");
    this.assertRateLimit(actor.orgId, actor.sub, "enrollments");
    return this.identity.enrollFromRobot(
      actor.orgId,
      actor.sub,
      body,
      idempotencyKey,
      correlationId,
    );
  }

  @Get("gallery")
  async gallery(
    @CurrentUser() actor: JwtPayload,
    @Query("sinceVersion") sinceVersion?: string,
    @Headers("if-none-match") ifNoneMatch?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (actor.type !== "robot") throw new ForbiddenException("Robot token required");
    const result = await this.identity.getRobotGallery(
      actor.orgId,
      actor.sub,
      sinceVersion,
    );
    const etag = `"${result.version}"`;
    res?.setHeader("ETag", etag);
    res?.setHeader("Cache-Control", "no-cache");
    if (
      result.notModified ||
      (ifNoneMatch &&
        ifNoneMatch
          .split(",")
          .map((value) => value.trim())
          .includes(etag))
    ) {
      res?.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return result;
  }

  @Post(":identityId/templates")
  async addTemplate(
    @CurrentUser() actor: JwtPayload,
    @Param("identityId", ParseIntPipe) identityId: number,
    @Body() body: RobotIdentityTemplateDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    if (actor.type !== "robot") throw new ForbiddenException("Robot token required");
    this.assertRateLimit(actor.orgId, actor.sub, "templates");
    return this.identity.addRobotTemplate(
      actor.orgId,
      actor.sub,
      identityId,
      body,
      idempotencyKey,
    );
  }

  @Post("feedback")
  async feedback(
    @CurrentUser() actor: JwtPayload,
    @Body() body: RobotIdentityFeedbackDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    if (actor.type !== "robot") throw new ForbiddenException("Robot token required");
    this.assertRateLimit(actor.orgId, actor.sub, "feedback");
    return this.identity.recordRecognitionFeedback(
      actor.orgId,
      actor.sub,
      body,
      idempotencyKey,
    );
  }

  @Get("models/:modelId")
  async model(
    @CurrentUser() actor: JwtPayload,
    @Param("modelId") modelId: string,
  ) {
    if (actor.type !== "robot") throw new ForbiddenException("Robot token required");
    const model = await this.identity.getRecognitionModelForRobot(
      actor.orgId,
      actor.sub,
      modelId,
    );
    return {
      ...model,
      checksumRequired: true,
    };
  }

  @Get("models/:modelId/download")
  async downloadModel(
    @CurrentUser() actor: JwtPayload,
    @Param("modelId") modelId: string,
    @Query("token") token?: string,
    @Res() res?: Response,
  ) {
    if (actor.type !== "robot") throw new ForbiddenException("Robot token required");
    const model = await this.identity.getRecognitionModelForRobot(
      actor.orgId,
      actor.sub,
      modelId,
    );
    if (
      !token ||
      !this.identity.verifyModelDownloadToken(actor.orgId, actor.sub, modelId, token)
    ) {
      throw new ForbiddenException("Signed model link is invalid or expired");
    }
    const download = await this.identity.getRecognitionModelDownload(
      actor.orgId,
      actor.sub,
      model.modelId,
    );
    res?.setHeader("Content-Type", "application/octet-stream");
    res?.setHeader("Content-Disposition", `attachment; filename="${download.fileId}.bin"`);
    res?.setHeader("X-Model-Id", download.modelId);
    res?.setHeader("X-Model-SHA256", download.sha256);
    return res ? res.send(download.bytes) : download.bytes;
  }

  private assertRateLimit(orgId: number, robotId: number, scope: string) {
    const key = `${orgId}:${robotId}:${scope}`;
    const now = Date.now();
    const current = this.enrollmentBuckets.get(key);
    if (!current || now - current.startedAt > 60_000) {
      this.enrollmentBuckets.set(key, { count: 1, startedAt: now });
      return;
    }
    current.count += 1;
    if (current.count > 30) {
      throw new HttpException(
        "Robot identity request rate limit exceeded",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
