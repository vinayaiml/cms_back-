// Permission keys (Option A: string permissions).
// These are NOT "roles". Roles are just bundles of these permissions in DB.
//
// Keep keys stable once released.

export const PERM = {
  // System / Super Admin
  SUPERADMIN: 'superadmin.*',

  // Orgs
  ORG_CREATE: 'org.create',
  ORG_READ: 'org.read',
  ORG_UPDATE: 'org.update',
  ORG_DELETE: 'org.delete',

  // Users / Roles / Permissions
  USER_CREATE: 'user.create',
  USER_READ: 'user.read',
  USER_UPDATE: 'user.update',
  USER_DELETE: 'user.delete',

  ROLE_CREATE: 'role.create',
  ROLE_READ: 'role.read',
  ROLE_UPDATE: 'role.update',
  ROLE_DELETE: 'role.delete',

  PERMISSION_MANAGE: 'permission.manage',

  // Dashboard sections
  DASHBOARD_SECTION_MANAGE: 'dashboard.section.manage',

  // Content
  CONTENT_IMPORT: 'content.import',
  CONTENT_READ: 'content.read',
  CONTENT_WRITE: 'content.write',
  CONTENT_ASSIGN: 'content.assign',

  // Robots & Licenses
  ROBOT_CREATE: 'robot.create',
  ROBOT_READ: 'robot.read',
  ROBOT_UPDATE: 'robot.update',
  ROBOT_LOCK: 'robot.lock',
  LICENSE_ISSUE: 'license.issue',
  LICENSE_RENEW: 'license.renew',

  // Robot Sync & Logs
  ROBOT_SYNC: 'robot.sync',
  ROBOT_LOGS_WRITE: 'robot.logs.write',

  // Notifications
  NOTIFICATION_READ: 'notification.read',
  NOTIFICATION_WRITE: 'notification.write',

  // Analytics (future)
  ANALYTICS_READ: 'analytics.read',
} as const;

export type PermissionKey = (typeof PERM)[keyof typeof PERM];
