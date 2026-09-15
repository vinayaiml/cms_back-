import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function assertAllowed() {
  if (process.env.CONFIRM_CLEAR_DATA !== 'DELETE_ROWS') {
    throw new Error('Set CONFIRM_CLEAR_DATA=DELETE_ROWS before clearing database rows');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to clear data with NODE_ENV=production');
  }

  const databaseUrl = process.env.DATABASE_URL || '';
  const isLocalDatabase = /localhost|127\.0\.0\.1/.test(databaseUrl);
  if (!isLocalDatabase && process.env.ALLOW_REMOTE_DATA_CLEAR !== 'true') {
    throw new Error('Remote database cleanup requires ALLOW_REMOTE_DATA_CLEAR=true');
  }
}

async function main() {
  assertAllowed();

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditEvent",
      "Event",
      "RobotUsageLog",
      "OrgCourseAccess",
      "Notification",
      "UserPermission",
      "UserRole",
      "RolePermission",
      "OrgPermission",
      "Role",
      "User",
      "Robot",
      "Lesson",
      "Chapter",
      "Level",
      "Course",
      "DashboardSection",
      "Organization",
      "Permission",
      "GlobalCounter"
    RESTART IDENTITY CASCADE
  `);

  console.log('Database rows cleared. Tables and schema were kept.');
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
