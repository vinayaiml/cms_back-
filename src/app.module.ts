import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { OrgsModule } from "./modules/orgs/orgs.module";
import { UsersModule } from "./modules/users/users.module";
import { RolesModule } from "./modules/roles/roles.module";
import { PermissionsModule } from "./modules/permissions/permissions.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { RobotsModule } from "./modules/robots/robots.module";
import { RobotSyncModule } from "./modules/robot-sync/robot-sync.module";
import { UsageLogsModule } from "./modules/usage-logs/usage-logs.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ContentModule } from "./modules/content/content.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { SectionsModule } from "./modules/sections/sections.module";
import { CourseAccessModule } from "./modules/course-access/course-access.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AuditModule } from "./modules/audit/audit.module";
import { CapabilitiesModule } from "./modules/capabilities/capabilities.module";
import { SubscriptionPlansModule } from "./modules/subscription-plans/subscription-plans.module";
import { EntitlementsModule } from "./modules/entitlements/entitlements.module";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { RobotOnlyGuard } from "./common/guards/robot-only.guard";
import { validateEnv } from "./config/env.validation";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    OrgsModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    DashboardModule,
    RobotsModule,
    RobotSyncModule,
    UsageLogsModule,
    NotificationsModule,
    ContentModule,
    SectionsModule,
    CourseAccessModule,
    AnalyticsModule,
    AuditModule,
    CapabilitiesModule,
    SubscriptionPlansModule,
    EntitlementsModule,
    JobsModule,
  ],
  providers: [PermissionsGuard, RobotOnlyGuard],
})
export class AppModule {}
