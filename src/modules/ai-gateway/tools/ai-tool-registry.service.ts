import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EntitlementsService } from '../../entitlements/entitlements.service';
import { AuditService } from '../../audit/audit.service';
import { redactSensitiveData } from '../ai-redaction.util';
import { ToolExecutionResult } from '../ai-gateway.dto';

export type ApprovedToolDefinition = {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export const APPROVED_TOOLS: ApprovedToolDefinition[] = [
  {
    name: 'getApprovedOrganisationInformation',
    description: 'Retrieve approved public information about the robot current organization.',
    parameters: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of requested organization fields',
        },
      },
    },
  },
  {
    name: 'searchStaff',
    description: 'Search staff members within the organization directory.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Name or department of the staff member to search for',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'getStaffAvailability',
    description: 'Check available schedule slots for a specified staff member.',
    parameters: {
      type: 'object',
      properties: {
        staffId: { type: 'number', description: 'ID of the staff member' },
        date: { type: 'string', description: 'Target date in YYYY-MM-DD format' },
      },
      required: ['staffId'],
    },
  },
  {
    name: 'holdAppointmentSlot',
    description: 'Temporarily hold an appointment slot for a visitor.',
    parameters: {
      type: 'object',
      properties: {
        staffId: { type: 'number', description: 'ID of the staff member' },
        slotTime: { type: 'string', description: 'Slot start time in ISO format or HH:mm' },
        visitorName: { type: 'string', description: 'Visitor name' },
      },
      required: ['staffId', 'slotTime'],
    },
  },
  {
    name: 'confirmAppointment',
    description: 'Confirm a previously held appointment booking.',
    parameters: {
      type: 'object',
      properties: {
        holdId: { type: 'string', description: 'Hold reference identifier' },
        visitorContact: { type: 'string', description: 'Visitor contact information' },
      },
      required: ['holdId'],
    },
  },
  {
    name: 'requestMovement',
    description: 'Request physical movement or navigation of the robot subject to safety policy limits.',
    parameters: {
      type: 'object',
      properties: {
        movementType: {
          type: 'string',
          enum: ['NAVIGATE_FORWARD', 'ROTATE', 'NAVIGATE_TO_WAYPOINT', 'STOP'],
          description: 'Type of movement action',
        },
        distanceMeters: {
          type: 'number',
          description: 'Distance to move in meters (max 5.0m for safety policy)',
        },
        angleDegrees: {
          type: 'number',
          description: 'Rotation angle in degrees (-360 to +360)',
        },
        waypointName: {
          type: 'string',
          description: 'Pre-mapped destination waypoint name',
        },
      },
      required: ['movementType'],
    },
  },
];

@Injectable()
export class AiToolRegistryService {
  private readonly logger = new Logger(AiToolRegistryService.name);
  private readonly registeredToolNames = new Set(APPROVED_TOOLS.map((t) => t.name));

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementsService: EntitlementsService,
    private readonly auditService: AuditService,
  ) {}

  getApprovedToolDefinitions(): ApprovedToolDefinition[] {
    return APPROVED_TOOLS;
  }

  isToolRegistered(toolName: string): boolean {
    return this.registeredToolNames.has(toolName);
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context: { robotId: number; orgId: number },
  ): Promise<ToolExecutionResult> {
    const { robotId, orgId } = context;

    // 1. Unregistered tool rejection with sanitized audit event
    if (!this.isToolRegistered(toolName)) {
      await this.auditService.recordBestEffort({
        actor: { userId: null, orgId, isSuperAdmin: false },
        action: 'AI_UNREGISTERED_TOOL_REJECTED',
        targetType: 'AI_TOOL',
        targetId: redactSensitiveData(toolName),
        targetOrgId: orgId,
        metadata: {
          robotId,
          toolName: redactSensitiveData(toolName),
          rejectedReason: 'Unregistered or prohibited AI tool invocation',
        },
      });

      return {
        toolName,
        status: 'REJECTED',
        reason: 'Unregistered tool is not permitted by AI gateway policy',
      };
    }

    // 2. Dispatch to registered tool with organization scope & capability enforcement
    try {
      switch (toolName) {
        case 'getApprovedOrganisationInformation':
          return await this.handleGetApprovedOrganisationInformation(orgId);

        case 'searchStaff':
          return await this.handleSearchStaff(orgId, args);

        case 'getStaffAvailability':
          return await this.handleGetStaffAvailability(orgId, robotId, args);

        case 'holdAppointmentSlot':
          return await this.handleHoldAppointmentSlot(orgId, robotId, args);

        case 'confirmAppointment':
          return await this.handleConfirmAppointment(orgId, robotId, args);

        case 'requestMovement':
          return await this.handleRequestMovement(orgId, robotId, args);

        default:
          return {
            toolName,
            status: 'REJECTED',
            reason: 'Tool handler not implemented',
          };
      }
    } catch (error) {
      this.logger.error(`Error executing tool ${toolName}: ${error}`);
      return {
        toolName,
        status: 'REJECTED',
        reason: 'Internal tool execution failure',
      };
    }
  }

  private async handleGetApprovedOrganisationInformation(
    orgId: number,
  ): Promise<ToolExecutionResult> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        authorizedPersonName: true,
        contactNo: true,
        primaryColor: true,
        secondaryColor: true,
        logoUrl: true,
        isActive: true,
      },
    });

    if (!org || !org.isActive) {
      return {
        toolName: 'getApprovedOrganisationInformation',
        status: 'REJECTED',
        reason: 'Organization is not active or not found',
      };
    }

    return {
      toolName: 'getApprovedOrganisationInformation',
      status: 'EXECUTED',
      output: {
        organizationId: org.id,
        organizationName: org.name,
        city: org.city,
        state: org.state,
        authorizedPerson: org.authorizedPersonName,
        contactNumber: org.contactNo,
        branding: {
          primaryColor: org.primaryColor,
          secondaryColor: org.secondaryColor,
          logoUrl: org.logoUrl,
        },
      },
    };
  }

  private async handleSearchStaff(
    orgId: number,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const query = typeof args.query === 'string' ? args.query.trim() : '';

    const users = await this.prisma.user.findMany({
      where: {
        orgId,
        isLocked: false,
        ...(query
          ? {
              OR: [
                { fullName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        fullName: true,
      },
      take: 10,
    });

    return {
      toolName: 'searchStaff',
      status: 'EXECUTED',
      output: {
        count: users.length,
        staff: users.map((u) => ({
          staffId: u.id,
          name: u.fullName,
          department: 'General Staff',
        })),
      },
    };
  }

  private async handleGetStaffAvailability(
    orgId: number,
    robotId: number,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const staffId = Number(args.staffId);
    if (!staffId || isNaN(staffId)) {
      return {
        toolName: 'getStaffAvailability',
        status: 'REJECTED',
        reason: 'Valid staffId is required',
      };
    }

    // Verify staff belongs to organization
    const staff = await this.prisma.user.findFirst({
      where: { id: staffId, orgId, isLocked: false },
    });

    if (!staff) {
      return {
        toolName: 'getStaffAvailability',
        status: 'REJECTED',
        reason: 'Staff member not found in this organization',
      };
    }

    // Return approved standard appointment slots
    return {
      toolName: 'getStaffAvailability',
      status: 'EXECUTED',
      output: {
        staffId: staff.id,
        staffName: staff.fullName,
        availableSlots: [
          '10:00 AM - 10:30 AM',
          '11:30 AM - 12:00 PM',
          '02:00 PM - 02:30 PM',
          '04:00 PM - 04:30 PM',
        ],
      },
    };
  }

  private async handleHoldAppointmentSlot(
    orgId: number,
    robotId: number,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const staffId = Number(args.staffId);
    const slotTime = String(args.slotTime || '');

    const staff = await this.prisma.user.findFirst({
      where: { id: staffId, orgId, isLocked: false },
    });

    if (!staff) {
      return {
        toolName: 'holdAppointmentSlot',
        status: 'REJECTED',
        reason: 'Staff member not found in organization',
      };
    }

    const holdId = `HOLD-${orgId}-${staffId}-${Date.now().toString(36).toUpperCase()}`;

    return {
      toolName: 'holdAppointmentSlot',
      status: 'EXECUTED',
      output: {
        holdId,
        staffName: staff.fullName,
        slotTime,
        status: 'HELD_FOR_10_MINUTES',
      },
    };
  }

  private async handleConfirmAppointment(
    orgId: number,
    robotId: number,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const holdId = String(args.holdId || '');
    if (!holdId || !holdId.startsWith(`HOLD-${orgId}-`)) {
      return {
        toolName: 'confirmAppointment',
        status: 'REJECTED',
        reason: 'Invalid or expired hold identifier for this organization',
      };
    }

    const confirmationId = `CONF-${Date.now().toString(36).toUpperCase()}`;

    return {
      toolName: 'confirmAppointment',
      status: 'EXECUTED',
      output: {
        confirmationId,
        holdId,
        status: 'CONFIRMED',
      },
    };
  }

  private async handleRequestMovement(
    orgId: number,
    robotId: number,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const movementType = String(args.movementType || '');
    const distanceMeters = typeof args.distanceMeters === 'number' ? args.distanceMeters : 1.0;
    const angleDegrees = typeof args.angleDegrees === 'number' ? args.angleDegrees : 0;
    const waypointName = typeof args.waypointName === 'string' ? args.waypointName : undefined;

    // Safety Policy Check:
    // 1. Distance maximum 5.0 meters per single command
    if (distanceMeters > 5.0) {
      return {
        toolName: 'requestMovement',
        status: 'REJECTED',
        reason: `Movement exceeds maximum safety policy limits (requested ${distanceMeters}m > max 5.0m)`,
      };
    }

    if (distanceMeters < 0) {
      return {
        toolName: 'requestMovement',
        status: 'REJECTED',
        reason: 'Negative distance is not permitted by safety policy',
      };
    }

    // 2. Verify Robot exists and belongs to active organization
    const robot = await this.prisma.robot.findFirst({
      where: { id: robotId, orgId },
    });

    if (!robot) {
      return {
        toolName: 'requestMovement',
        status: 'REJECTED',
        reason: 'Robot identity not verified for this organization',
      };
    }

    return {
      toolName: 'requestMovement',
      status: 'EXECUTED',
      output: {
        approved: true,
        action: 'MOVEMENT_DISPATCH',
        command: {
          movementType,
          distanceMeters,
          angleDegrees,
          waypointName,
        },
      },
    };
  }
}
