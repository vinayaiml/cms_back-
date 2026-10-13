import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { LicenseStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { AuditService } from "../audit/audit.service";
import { redactValue } from "./ai-redaction";

export type RegisteredAiToolName =
  | "getApprovedOrganisationInformation"
  | "searchStaff"
  | "getStaffAvailability"
  | "holdAppointmentSlot"
  | "confirmAppointment"
  | "requestMovement";

export type AiToolCallInput = {
  robotId: number;
  orgId: number;
  name: string;
  arguments?: Record<string, unknown>;
  correlationId?: string | null;
};

const TOOL_CAPABILITIES: Record<RegisteredAiToolName, string[]> = {
  getApprovedOrganisationInformation: ["ai.conversation"],
  searchStaff: ["ai.conversation", "ai.staff.search"],
  getStaffAvailability: ["ai.conversation", "ai.appointment"],
  holdAppointmentSlot: ["ai.conversation", "ai.appointment"],
  confirmAppointment: ["ai.conversation", "ai.appointment"],
  requestMovement: ["ai.conversation", "robot.movement.request"],
};

const TOOL_PERMISSIONS: Record<RegisteredAiToolName, string[]> = {
  getApprovedOrganisationInformation: ["ai.conversation"],
  searchStaff: ["ai.conversation", "ai.staff.search"],
  getStaffAvailability: ["ai.conversation", "ai.appointment.manage"],
  holdAppointmentSlot: ["ai.conversation", "ai.appointment.manage"],
  confirmAppointment: ["ai.conversation", "ai.appointment.manage"],
  requestMovement: ["ai.conversation", "robot.movement.request"],
};

@Injectable()
export class AiToolRegistryService {
  constructor(
    private prisma: PrismaService,
    private entitlements: EntitlementsService,
    private audit: AuditService,
  ) {}

  listTools() {
    return Object.keys(TOOL_CAPABILITIES);
  }

  toolDefinitions(names: string[] = this.listTools()) {
    return names
      .filter((name): name is RegisteredAiToolName => this.isRegistered(name))
      .map((name) => ({
        type: "function" as const,
        function: {
          name,
          description: this.toolDescription(name),
          parameters: {
            type: "object",
            additionalProperties: true,
            properties: {},
          },
        },
      }));
  }

  async permittedToolNames(robotId: number, orgId: number) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: {
        id: true,
        orgId: true,
        validUntil: true,
        revokedAt: true,
        hardwareModel: true,
        hardwareProfile: true,
        hardwareCapabilities: true,
        org: { select: { isActive: true } },
      },
    });
    if (!robot || robot.orgId !== orgId || !robot.org.isActive) return [];
    if (this.licenseStatus(robot.validUntil, robot.revokedAt) !== LicenseStatus.ACTIVE) {
      return [];
    }

    const permissionRows = await this.prisma.orgPermission.findMany({
      where: { orgId, permission: { key: { in: Array.from(new Set(Object.values(TOOL_PERMISSIONS).flat())) } } },
      include: { permission: true },
    });
    const permissionKeys = new Set(permissionRows.map((row) => row.permission.key));
    const capabilityKeys = await this.entitlements.resolveCapabilityKeys({
      orgId,
      robotId,
      hardwareModel: robot.hardwareModel,
      hardwareProfile: robot.hardwareProfile,
      hardwareCapabilities: robot.hardwareCapabilities,
      enforceHardware: true,
    });

    return this.listTools().filter((name) => {
      if (!this.isRegistered(name)) return false;
      return (
        TOOL_PERMISSIONS[name].every((permission) => permissionKeys.has(permission)) &&
        TOOL_CAPABILITIES[name].every((capability) => capabilityKeys.has(capability))
      );
    });
  }

  isRegistered(name: string): name is RegisteredAiToolName {
    return Object.prototype.hasOwnProperty.call(TOOL_CAPABILITIES, name);
  }

  async execute(input: AiToolCallInput) {
    if (!this.isRegistered(input.name)) {
      await this.auditRejectedTool(input, "UNREGISTERED_TOOL");
      throw new BadRequestException("AI tool is not registered");
    }

    const robot = await this.prisma.robot.findUnique({
      where: { id: input.robotId },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            isActive: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            tenantVersion: true,
          },
        },
      },
    });
    if (!robot || robot.orgId !== input.orgId || !robot.org.isActive) {
      await this.auditRejectedTool(input, "ORG_SCOPE_OR_INACTIVE");
      throw new ForbiddenException("AI tool is not authorized");
    }

    const status = this.licenseStatus(robot.validUntil, robot.revokedAt);
    if (status !== LicenseStatus.ACTIVE) {
      await this.auditRejectedTool(input, "LICENSE_LOCKED");
      throw new ForbiddenException("AI tool is not authorized");
    }

    const permissionRows = await this.prisma.orgPermission.findMany({
      where: {
        orgId: robot.orgId,
        permission: { key: { in: TOOL_PERMISSIONS[input.name] } },
      },
      include: { permission: true },
    });
    const permissionKeys = new Set(
      permissionRows.map((row) => row.permission.key),
    );
    for (const permission of TOOL_PERMISSIONS[input.name]) {
      if (!permissionKeys.has(permission)) {
        await this.auditRejectedTool(input, "PERMISSION_DENIED");
        throw new ForbiddenException("AI tool is not authorized");
      }
    }

    const capabilityKeys = await this.entitlements.resolveCapabilityKeys({
      orgId: robot.orgId,
      robotId: robot.id,
      hardwareModel: robot.hardwareModel,
      hardwareProfile: robot.hardwareProfile,
      hardwareCapabilities: robot.hardwareCapabilities,
      enforceHardware: true,
    });
    for (const capability of TOOL_CAPABILITIES[input.name]) {
      if (!capabilityKeys.has(capability)) {
        await this.auditRejectedTool(input, "CAPABILITY_DENIED");
        throw new ForbiddenException("AI tool is not authorized");
      }
    }

    if (input.name === "requestMovement") {
      await this.audit.recordBestEffort({
        actor: { userId: null, orgId: robot.orgId, isSuperAdmin: false },
        action: "ai.tool.movement_requested",
        targetType: "robot",
        targetId: robot.id,
        targetOrgId: robot.orgId,
        correlationId: input.correlationId,
        metadata: {
          toolName: input.name,
          requestId: randomUUID(),
          arguments: redactValue(input.arguments ?? {}),
          status: "REQUIRES_APPROVED_SAFETY_POLICY",
        } as any,
      });
      return {
        status: "requires_approval",
        message: "Movement request accepted for policy review.",
      };
    }

    if (input.name === "getApprovedOrganisationInformation") {
      return {
        orgId: robot.org.id,
        orgName: robot.org.name,
        displayName: robot.org.name,
        logoUrl: robot.org.logoUrl,
        primaryColor: robot.org.primaryColor,
        secondaryColor: robot.org.secondaryColor,
        tenantVersion: robot.org.tenantVersion,
        cacheVersion: `org-${robot.org.id}-v${robot.org.tenantVersion}`,
      };
    }

    return {
      status: "not_available",
      message: "This approved tool is not connected to live scheduling data yet.",
    };
  }

  private licenseStatus(validUntil: Date, revokedAt: Date | null) {
    if (revokedAt) return LicenseStatus.REVOKED;
    if (validUntil.getTime() < Date.now()) return LicenseStatus.EXPIRED;
    return LicenseStatus.ACTIVE;
  }

  private toolDescription(name: RegisteredAiToolName) {
    const descriptions: Record<RegisteredAiToolName, string> = {
      getApprovedOrganisationInformation:
        "Return approved organization display context for the active tenant.",
      searchStaff:
        "Search approved staff directory entries for the active tenant.",
      getStaffAvailability:
        "Return approved staff availability slots for the active tenant.",
      holdAppointmentSlot:
        "Hold an appointment slot after policy and permission checks.",
      confirmAppointment:
        "Confirm a previously held appointment slot.",
      requestMovement:
        "Request a movement action. This never directly drives motors.",
    };
    return descriptions[name];
  }

  private async auditRejectedTool(input: AiToolCallInput, reason: string) {
    await this.audit.recordBestEffort({
      actor: { userId: null, orgId: input.orgId, isSuperAdmin: false },
      action: "ai.tool.rejected",
      targetType: "robot",
      targetId: input.robotId,
      targetOrgId: input.orgId,
      correlationId: input.correlationId,
      metadata: {
        reason,
        toolName: input.name,
        arguments: redactValue(input.arguments ?? {}),
      } as any,
    });
  }
}
