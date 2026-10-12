import { Body, Controller, ForbiddenException, Headers, Post, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { JwtAuthGuard } from "../../common/auth/jwt-auth.guard";
import { JwtPayload } from "../../common/auth/jwt.types";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RobotOnly } from "../../common/decorators/robot-only.decorator";
import { RobotOnlyGuard } from "../../common/guards/robot-only.guard";
import { RobotAiConversationDto } from "./ai-gateway.dto";
import { AiGatewayService } from "./ai-gateway.service";

@Controller(["robot/ai/conversation", "v1/robot/ai/conversation"])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class AiGatewayController {
  constructor(private gateway: AiGatewayService) {}

  @Post()
  async converse(
    @CurrentUser() actor: JwtPayload,
    @Body() body: RobotAiConversationDto,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    if (actor.type !== "robot") throw new ForbiddenException("Robot token required");

    return this.gateway.converse({
      robotId: actor.sub,
      orgId: actor.orgId,
      body,
      correlationId,
    });
  }

  @Post("stream")
  async stream(
    @CurrentUser() actor: JwtPayload,
    @Body() body: RobotAiConversationDto,
    @Res() res: Response,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    if (actor.type !== "robot") throw new ForbiddenException("Robot token required");

    const requestId = correlationId || `ai-${Date.now()}`;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const write = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 10000);
    // Stop generating (and paying for) an answer once the robot has disconnected.
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) clientGone = true;
    });

    write("ack", { requestId });
    try {
      for await (const event of this.gateway.streamEvents({
        robotId: actor.sub,
        orgId: actor.orgId,
        body,
        correlationId: requestId,
      })) {
        if (clientGone) break;
        write(event.type, event.data);
      }
    } catch {
      write("error", { code: "AI_STREAM_FAILED" });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }

}
