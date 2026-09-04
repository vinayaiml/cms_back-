import { Prisma } from '@prisma/client';

export type AuditActor = {
  userId: number | null;
  orgId: number | null;
  isSuperAdmin: boolean;
};

export type RecordAuditEventInput = {
  actor: AuditActor;
  action: string;
  targetType: string;
  targetId: string | number;
  targetOrgId?: number | null;
  correlationId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

export type AuditListFilters = {
  orgId?: number;
  action?: string;
  targetType?: string;
  limit?: number;
};
