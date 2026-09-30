import {
  Prisma,
  PrismaClient,
  DashboardTemplateType,
  LicenseStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";
import {
  encryptLicenseKey,
  licenseFingerprint,
} from "../src/common/security/license-secret";
import { normalizeRobotHardwareProfile } from "../src/modules/robots/robot-hardware-profile";

function seedDatabaseUrl() {
  const directDatabaseUrl = process.env.DIRECT_DATABASE_URL?.trim();
  if (directDatabaseUrl) return directDatabaseUrl;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) return undefined;

  try {
    const url = new URL(databaseUrl);
    if (
      url.hostname.includes("-pooler.") &&
      url.hostname.endsWith(".neon.tech")
    ) {
      url.hostname = url.hostname.replace("-pooler.", ".");
      return url.toString();
    }
  } catch {
    return databaseUrl;
  }

  return databaseUrl;
}

const seedUrl = seedDatabaseUrl();
const prisma = new PrismaClient(
  seedUrl ? { datasources: { db: { url: seedUrl } } } : undefined,
);

function protectedLicenseData(licenseKey: string) {
  return {
    licenseKey: null,
    licenseKeyCiphertext: encryptLicenseKey(licenseKey),
    licenseKeyFingerprint: licenseFingerprint(licenseKey),
  };
}

function hardwareProfileData(model: "MINI_ELF" | "ELF" | "NANO" | "S5") {
  const profiles = {
    MINI_ELF: {
      model: "MINI_ELF",
      manufacturer: "Sanbot",
      androidApiLevel: 25,
      abi: "arm64-v8a",
      display: { width: 1920, height: 1200 },
      capabilities: { autonomousNavigation: true, armMotion: true },
    },
    ELF: {
      model: "ELF",
      manufacturer: "Sanbot",
      androidApiLevel: 23,
      abi: "armeabi-v7a",
      display: { width: 1920, height: 1200 },
    },
    NANO: {
      model: "NANO",
      manufacturer: "Sanbot",
      androidApiLevel: 23,
      abi: "armeabi-v7a",
      display: { width: 1920, height: 1200 },
    },
    S5: {
      model: "S5",
      manufacturer: "Sanbot",
      androidApiLevel: 31,
      abi: "arm64-v8a",
      display: { width: 1920, height: 1080 },
    },
  } as const;
  return normalizeRobotHardwareProfile(profiles[model]);
}

function requiredSeedValue(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for seed data`);
  }
  return value;
}

const permissions = [
  // super admin wildcard (treated as bypass in guard too)
  {
    key: "superadmin.*",
    description: "All permissions (Super Admin only)",
    category: "system",
  },

  { key: "org.create", description: "Create organizations", category: "org" },
  { key: "org.read", description: "Read organizations", category: "org" },
  { key: "org.update", description: "Update organizations", category: "org" },
  { key: "org.delete", description: "Delete organizations", category: "org" },

  { key: "user.create", description: "Create users", category: "users" },
  { key: "user.read", description: "Read users", category: "users" },
  { key: "user.update", description: "Update users", category: "users" },
  { key: "user.delete", description: "Delete users", category: "users" },

  { key: "role.create", description: "Create roles", category: "roles" },
  { key: "role.read", description: "Read roles", category: "roles" },
  { key: "role.update", description: "Update roles", category: "roles" },
  { key: "role.delete", description: "Delete roles", category: "roles" },

  {
    key: "permission.manage",
    description: "Manage permission catalog",
    category: "permissions",
  },
  {
    key: "capability.read",
    description: "Read robot capability catalog",
    category: "capabilities",
  },
  {
    key: "capability.manage",
    description: "Manage robot capability catalog",
    category: "capabilities",
  },
  {
    key: "subscription.read",
    description: "Read subscription plans",
    category: "subscriptions",
  },
  {
    key: "subscription.manage",
    description: "Manage subscription plans",
    category: "subscriptions",
  },

  {
    key: "dashboard.section.manage",
    description: "Manage dashboard sections",
    category: "dashboard",
  },

  {
    key: "content.import",
    description: "Import content via CSV/XLSX",
    category: "content",
  },
  { key: "content.read", description: "Read content", category: "content" },
  {
    key: "content.write",
    description: "Create/update content",
    category: "content",
  },
  {
    key: "content.assign",
    description: "Assign courses/bundles to org",
    category: "content",
  },

  { key: "robot.create", description: "Register robots", category: "robots" },
  { key: "robot.read", description: "Read robot details", category: "robots" },
  {
    key: "robot.update",
    description: "Update robot details",
    category: "robots",
  },
  { key: "robot.lock", description: "Lock/unlock robots", category: "robots" },

  {
    key: "license.issue",
    description: "Issue robot licenses",
    category: "license",
  },
  {
    key: "license.renew",
    description: "Renew robot licenses",
    category: "license",
  },

  {
    key: "robot.sync",
    description: "Robot sync (internal)",
    category: "robot",
  },
  {
    key: "robot.logs.write",
    description: "Upload robot usage logs",
    category: "robot",
  },

  {
    key: "notification.read",
    description: "Read notifications",
    category: "notifications",
  },
  {
    key: "notification.write",
    description: "Create notifications",
    category: "notifications",
  },

  {
    key: "analytics.read",
    description: "Read analytics",
    category: "analytics",
  },

  {
    key: "audit.read",
    description: "Read administrative audit events",
    category: "audit",
  },
];

const capabilityCatalog = [
  {
    stableKey: "camera.capture",
    name: "Camera Capture",
    description:
      "Capture still images or video frames from approved robot cameras.",
    category: "vision",
    version: 1,
    requiredHardware: {
      capabilities: ["camera"],
      models: ["MINI_ELF", "ELF", "NANO", "S5"],
    },
  },
  {
    stableKey: "audio.microphone",
    name: "Microphone Input",
    description:
      "Use approved robot microphone hardware for local audio input.",
    category: "audio",
    version: 1,
    requiredHardware: { capabilities: ["microphone"] },
  },
  {
    stableKey: "audio.speaker",
    name: "Speaker Output",
    description: "Use approved robot speaker hardware for audio output.",
    category: "audio",
    version: 1,
    requiredHardware: { capabilities: ["speaker"] },
  },
  {
    stableKey: "display.touch",
    name: "Touch Display",
    description: "Use the robot touch display for app interaction.",
    category: "display",
    version: 1,
    requiredHardware: { capabilities: ["touchDisplay"] },
  },
  {
    stableKey: "speech.recognition",
    name: "Speech Recognition",
    description:
      "Run approved speech recognition flows on compatible robot hardware.",
    category: "speech",
    version: 1,
    requiredHardware: {
      capabilities: ["speechRecognition"],
      minAndroidApiLevel: 23,
    },
  },
  {
    stableKey: "media.video-playback",
    name: "Video Playback",
    description: "Play approved video content on compatible robot displays.",
    category: "media",
    version: 1,
    requiredHardware: { capabilities: ["videoPlayback"] },
  },
];

const subscriptionPlans = [
  {
    stableKey: "starter",
    name: "Starter",
    description: "Baseline robot app capabilities for integration testing.",
    version: 1,
    capabilityStableKeys: [
      "audio.speaker",
      "display.touch",
      "media.video-playback",
    ],
  },
  {
    stableKey: "speech-plus",
    name: "Speech Plus",
    description:
      "Adds speech recognition and microphone input to the starter plan.",
    version: 1,
    capabilityStableKeys: [
      "audio.microphone",
      "audio.speaker",
      "display.touch",
      "media.video-playback",
      "speech.recognition",
    ],
  },
];

async function main() {
  // Upsert permission catalog
  for (const p of permissions) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { description: p.description, category: p.category },
      create: p,
    });
  }

  // Upsert robot capability catalog
  for (const capability of capabilityCatalog) {
    await prisma.capability.upsert({
      where: { stableKey: capability.stableKey },
      update: {
        name: capability.name,
        description: capability.description,
        category: capability.category,
        version: capability.version,
        requiredHardware: capability.requiredHardware,
        isActive: true,
      },
      create: {
        stableKey: capability.stableKey,
        name: capability.name,
        description: capability.description,
        category: capability.category,
        version: capability.version,
        requiredHardware: capability.requiredHardware,
        isActive: true,
      },
    });
  }

  // Upsert subscription plans and replace their configured capabilities exactly.
  for (const planConfig of subscriptionPlans) {
    const plan = await prisma.subscriptionPlan.upsert({
      where: { stableKey: planConfig.stableKey },
      update: {
        name: planConfig.name,
        description: planConfig.description,
        version: planConfig.version,
        isActive: true,
      },
      create: {
        stableKey: planConfig.stableKey,
        name: planConfig.name,
        description: planConfig.description,
        version: planConfig.version,
        isActive: true,
      },
    });

    const capabilities = await prisma.capability.findMany({
      where: {
        stableKey: { in: planConfig.capabilityStableKeys },
        isActive: true,
      },
      select: { id: true },
    });

    await prisma.planCapability.deleteMany({ where: { planId: plan.id } });
    if (capabilities.length) {
      await prisma.planCapability.createMany({
        data: capabilities.map((capability) => ({
          planId: plan.id,
          capabilityId: capability.id,
        })),
        skipDuplicates: true,
      });
    }
  }

  const defaultOrgPermissionKeys = permissions
    .map((p) => p.key)
    .filter((k) => k !== "superadmin.*");

  // Create the single Super Admin (if not exists)
  const superEmail = process.env.SUPER_ADMIN_EMAIL || "superadmin@whizrobo.com";
  const superPass = requiredSeedValue("SUPER_ADMIN_PASSWORD");
  const passwordHash = await bcrypt.hash(superPass, 10);

  const existing = await prisma.user.findUnique({
    where: { email: superEmail },
  });
  if (!existing) {
    await prisma.user.create({
      data: {
        email: superEmail,
        fullName: "Super Admin",
        passwordHash,
        isSuperAdmin: true,
      },
    });
    console.log("✅ Super Admin created:", superEmail);
  } else {
    console.log("ℹ️ Super Admin exists:", superEmail);
  }

  // Seed dashboard sections (template-driven UI)
  const sections: Array<{
    key: string;
    label: string;
    path: string;
    icon: string;
    sortOrder: number;
    requiredPermission?: string;
    isSuperAdminOnly?: boolean;
    templateType?: DashboardTemplateType;
    templateConfig?: Record<string, any>;
  }> = [
    {
      key: "dashboard",
      label: "Dashboard",
      path: "/dashboard",
      icon: "home",
      sortOrder: 1,
    },

    // Super Admin
    {
      key: "organizations",
      label: "Organizations",
      path: "/organizations",
      icon: "building",
      sortOrder: 2,
      requiredPermission: "org.read",
      isSuperAdminOnly: true,
    },
    {
      key: "course-access",
      label: "Course Access",
      path: "/course-access",
      icon: "key",
      sortOrder: 3,
      requiredPermission: "content.assign",
      isSuperAdminOnly: true,
    },
    {
      key: "permissions",
      label: "Permissions",
      path: "/permissions",
      icon: "shield",
      sortOrder: 98,
      requiredPermission: "permission.manage",
      isSuperAdminOnly: true,
    },
    {
      key: "sections",
      label: "Sections Builder",
      path: "/sections",
      icon: "layout",
      sortOrder: 99,
      requiredPermission: "dashboard.section.manage",
      isSuperAdminOnly: true,
    },

    // Org dashboards
    {
      key: "team",
      label: "Team Home",
      path: "/team",
      icon: "layout",
      sortOrder: 9,
      requiredPermission: "content.read",
      templateType: "WIDGETS" as DashboardTemplateType,
      templateConfig: {
        title: "Team Dashboard",
        description: "Quick shortcuts and KPIs for your team.",
        analytics: { days: 7 },
        widgets: [
          {
            type: "LINK",
            label: "Content",
            path: "/content",
            requiredPermission: "content.read",
          },
          {
            type: "LINK",
            label: "Robots",
            path: "/robots",
            requiredPermission: "robot.read",
          },
          {
            type: "LINK",
            label: "Users",
            path: "/users",
            requiredPermission: "user.read",
          },
          {
            type: "LINK",
            label: "Roles",
            path: "/roles",
            requiredPermission: "role.read",
          },
          {
            type: "LINK",
            label: "Notifications",
            path: "/notifications",
            requiredPermission: "notification.read",
          },
          {
            type: "LINK",
            label: "Analytics",
            path: "/analytics",
            requiredPermission: "analytics.read",
          },
          {
            type: "KPI",
            label: "Plays (7d)",
            metric: "usage.plays",
            format: "NUMBER",
            requiredPermission: "analytics.read",
          },
          {
            type: "KPI",
            label: "Duration (7d)",
            metric: "usage.durationSec",
            format: "HOURS",
            requiredPermission: "analytics.read",
          },
        ],
      },
    },
    {
      key: "content",
      label: "Content",
      path: "/content",
      icon: "book",
      sortOrder: 10,
      requiredPermission: "content.read",
    },
    {
      key: "robots",
      label: "Robots",
      path: "/robots",
      icon: "robot",
      sortOrder: 11,
      requiredPermission: "robot.read",
    },
    {
      key: "users",
      label: "Users",
      path: "/users",
      icon: "users",
      sortOrder: 12,
      requiredPermission: "user.read",
    },
    {
      key: "roles",
      label: "Roles",
      path: "/roles",
      icon: "lock",
      sortOrder: 13,
      requiredPermission: "role.read",
    },
    {
      key: "notifications",
      label: "Notifications",
      path: "/notifications",
      icon: "bell",
      sortOrder: 14,
      requiredPermission: "notification.read",
    },
    {
      key: "subscription-plans",
      label: "Plans",
      path: "/subscription-plans",
      icon: "layers",
      sortOrder: 16,
      requiredPermission: "subscription.read",
    },
    {
      key: "capability-assignments",
      label: "Capability Access",
      path: "/capability-assignments",
      icon: "sliders",
      sortOrder: 17,
      requiredPermission: "subscription.manage",
      isSuperAdminOnly: true,
    },

    // Dynamic analytics page (no code page required)
    {
      key: "analytics",
      label: "Analytics",
      path: "/analytics",
      icon: "chart",
      sortOrder: 15,
      requiredPermission: "analytics.read",
      templateType: "KPI_OVERVIEW" as DashboardTemplateType,
      templateConfig: {
        title: "Analytics Overview",
        description:
          "Usage insights based on robot logs (offline-first, uploaded asynchronously).",
        days: 7,
        showTopCourses: true,
        showTopLessons: true,
      },
    },
  ];

  for (const s of sections) {
    await prisma.dashboardSection.upsert({
      where: { key: s.key },
      update: s,
      create: s,
    });
  }

  // --- Seed demo org + org admin (optional, remove in production) ---
  let demoOrg = await prisma.organization.findFirst({
    where: { name: "Demo School" },
  });
  if (!demoOrg) {
    demoOrg = await prisma.organization.create({
      data: {
        name: "Demo School",
        state: "Maharashtra",
        city: "Mumbai",
        authorizedPersonName: "Rajesh Kumar",
        contactNo: "9876543210",
        logoUrl: "https://assets.whizrobo.test/orgs/demo-school-logo.png",
        primaryColor: "#1D4ED8",
        secondaryColor: "#F97316",
        tenantVersion: 1,
      },
    });
  } else {
    demoOrg = await prisma.organization.update({
      where: { id: demoOrg.id },
      data: {
        logoUrl: "https://assets.whizrobo.test/orgs/demo-school-logo.png",
        primaryColor: "#1D4ED8",
        secondaryColor: "#F97316",
        tenantVersion: demoOrg.tenantVersion || 1,
      },
    });
  }

  // Seed organization-level permission grants (super admin controls this set later).
  for (const key of defaultOrgPermissionKeys) {
    const perm = await prisma.permission.findUnique({ where: { key } });
    if (!perm) continue;
    await prisma.orgPermission.upsert({
      where: {
        orgId_permissionId: { orgId: demoOrg.id, permissionId: perm.id },
      },
      update: {},
      create: { orgId: demoOrg.id, permissionId: perm.id },
    });
  }

  const orgAdminRole = await prisma.role.upsert({
    where: { orgId_name: { orgId: demoOrg.id, name: "Org Admin" } },
    update: { description: "Organization administrator" },
    create: {
      orgId: demoOrg.id,
      name: "Org Admin",
      description: "Organization administrator",
    },
  });

  const orgPermKeys = [
    "user.create",
    "user.read",
    "user.update",

    "role.create",
    "role.read",
    "role.update",

    "content.import",
    "content.read",
    "content.write",

    "robot.read",

    "notification.read",

    "analytics.read",
    "audit.read",
  ];

  for (const key of orgPermKeys) {
    const perm = await prisma.permission.findUnique({ where: { key } });
    if (!perm) continue;
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: orgAdminRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: orgAdminRole.id, permissionId: perm.id },
    });
  }

  const demoEmail = process.env.DEMO_ADMIN_EMAIL || "admin@demo.com";
  const demoPass = requiredSeedValue("DEMO_ADMIN_PASSWORD");
  const demoHash = await bcrypt.hash(demoPass, 10);
  const testUserPass = requiredSeedValue("TEST_USER_PASSWORD");

  const demoUser = await prisma.user.upsert({
    where: { email: demoEmail },
    update: { fullName: "Demo Admin", orgId: demoOrg.id, isSuperAdmin: false },
    create: {
      email: demoEmail,
      fullName: "Demo Admin",
      passwordHash: demoHash,
      orgId: demoOrg.id,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: demoUser.id, roleId: orgAdminRole.id } },
    update: {},
    create: { userId: demoUser.id, roleId: orgAdminRole.id },
  });

  console.log("✅ Demo org admin:", demoEmail);

  // --- COMPREHENSIVE TEST DATA ---

  // Create more organizations
  console.log("📦 Creating test organizations...");
  const orgs = [];
  const testOrgData = [
    {
      name: "Test School 1",
      state: "Delhi",
      city: "New Delhi",
      authorizedPersonName: "Amit Sharma",
      contactNo: "9876543211",
      logoUrl: "https://assets.whizrobo.test/orgs/test-school-1-logo.png",
      primaryColor: "#0F766E",
      secondaryColor: "#FACC15",
      tenantVersion: 1,
    },
    {
      name: "Test School 2",
      state: "Karnataka",
      city: "Bengaluru",
      authorizedPersonName: "Priya Patel",
      contactNo: "9876543212",
      logoUrl: "https://assets.whizrobo.test/orgs/test-school-2-logo.png",
      primaryColor: "#7C3AED",
      secondaryColor: "#22C55E",
      tenantVersion: 2,
    },
    {
      name: "Test School 3",
      state: "Tamil Nadu",
      city: "Chennai",
      authorizedPersonName: "Suresh Reddy",
      contactNo: "9876543213",
      logoUrl: "https://assets.whizrobo.test/orgs/test-school-3-logo.png",
      primaryColor: "#BE123C",
      secondaryColor: "#38BDF8",
      tenantVersion: 3,
    },
  ];
  for (const orgData of testOrgData) {
    let org = await prisma.organization.findFirst({
      where: { name: orgData.name },
    });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: orgData.name,
          state: orgData.state,
          city: orgData.city,
          authorizedPersonName: orgData.authorizedPersonName,
          contactNo: orgData.contactNo,
          logoUrl: orgData.logoUrl,
          primaryColor: orgData.primaryColor,
          secondaryColor: orgData.secondaryColor,
          tenantVersion: orgData.tenantVersion,
        },
      });
    } else {
      org = await prisma.organization.update({
        where: { id: org.id },
        data: {
          logoUrl: orgData.logoUrl,
          primaryColor: orgData.primaryColor,
          secondaryColor: orgData.secondaryColor,
          tenantVersion: orgData.tenantVersion,
        },
      });
    }
    orgs.push(org);

    for (const key of defaultOrgPermissionKeys) {
      const perm = await prisma.permission.findUnique({ where: { key } });
      if (!perm) continue;
      await prisma.orgPermission.upsert({
        where: { orgId_permissionId: { orgId: org.id, permissionId: perm.id } },
        update: {},
        create: { orgId: org.id, permissionId: perm.id },
      });
    }
  }

  async function seedOrgSubscription(
    orgId: number,
    planStableKey: string,
    validFrom: Date,
    validUntil: Date,
    status: "ACTIVE" | "INACTIVE" = "ACTIVE",
  ) {
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { stableKey: planStableKey },
      select: { id: true },
    });
    if (!plan) return;

    await prisma.organizationSubscription.deleteMany({ where: { orgId } });
    await prisma.organizationSubscription.create({
      data: {
        orgId,
        planId: plan.id,
        status,
        validFrom,
        validUntil,
      },
    });
  }

  const subscriptionNow = new Date();
  await seedOrgSubscription(
    demoOrg.id,
    "speech-plus",
    new Date(subscriptionNow.getTime() - 30 * 24 * 60 * 60 * 1000),
    new Date(subscriptionNow.getTime() + 365 * 24 * 60 * 60 * 1000),
  );

  if (orgs[0]) {
    await seedOrgSubscription(
      orgs[0].id,
      "starter",
      new Date(subscriptionNow.getTime() - 365 * 24 * 60 * 60 * 1000),
      new Date(subscriptionNow.getTime() - 30 * 24 * 60 * 60 * 1000),
    );
  }

  // Create roles for each org
  console.log("👥 Creating roles...");
  const rolesByOrg: Record<number, any> = {};
  const roleNames = ["Org Admin", "Manager", "Teacher", "Viewer"];

  for (const org of [demoOrg, ...orgs]) {
    rolesByOrg[org.id] = {};

    for (const roleName of roleNames) {
      let role = await prisma.role.findFirst({
        where: { orgId: org.id, name: roleName },
      });
      if (!role) {
        role = await prisma.role.create({
          data: {
            orgId: org.id,
            name: roleName,
            description: `${roleName} role for ${org.name}`,
          },
        });
      }
      rolesByOrg[org.id][roleName] = role;

      // Assign permissions based on role
      let permKeys: string[] = [];
      if (roleName === "Org Admin") {
        permKeys = [
          "user.create",
          "user.read",
          "user.update",
          "user.delete",
          "role.create",
          "role.read",
          "role.update",
          "role.delete",
          "content.import",
          "content.read",
          "content.write",
          "robot.create",
          "robot.read",
          "robot.update",
          "robot.lock",
          "license.issue",
          "license.renew",
          "notification.read",
          "analytics.read",
          "audit.read",
          "dashboard.section.manage",
        ];
      } else if (roleName === "Manager") {
        permKeys = [
          "user.read",
          "user.update",
          "content.read",
          "content.write",
          "robot.read",
          "robot.update",
          "license.renew",
          "notification.read",
          "analytics.read",
        ];
      } else if (roleName === "Teacher") {
        permKeys = [
          "content.read",
          "content.write",
          "robot.read",
          "notification.read",
          "analytics.read",
        ];
      } else {
        permKeys = ["content.read", "notification.read", "analytics.read"];
      }

      for (const key of permKeys) {
        const perm = await prisma.permission.findUnique({ where: { key } });
        if (perm) {
          await prisma.rolePermission.upsert({
            where: {
              roleId_permissionId: { roleId: role.id, permissionId: perm.id },
            },
            update: {},
            create: { roleId: role.id, permissionId: perm.id },
          });
        }
      }
    }
  }

  // Create users for each org
  console.log("👤 Creating test users...");
  const usersByOrg: Record<number, any[]> = {};

  for (const org of [demoOrg, ...orgs]) {
    usersByOrg[org.id] = [];

    const userConfigs = [
      {
        email: `admin@${org.name.toLowerCase().replace(/\s+/g, "")}.com`,
        name: "Organization Admin",
        role: "Org Admin",
      },
      {
        email: `manager@${org.name.toLowerCase().replace(/\s+/g, "")}.com`,
        name: "Manager",
        role: "Manager",
      },
      {
        email: `teacher1@${org.name.toLowerCase().replace(/\s+/g, "")}.com`,
        name: "Teacher 1",
        role: "Teacher",
      },
      {
        email: `teacher2@${org.name.toLowerCase().replace(/\s+/g, "")}.com`,
        name: "Teacher 2",
        role: "Teacher",
      },
      {
        email: `viewer@${org.name.toLowerCase().replace(/\s+/g, "")}.com`,
        name: "Viewer",
        role: "Viewer",
      },
    ];

    for (const userConfig of userConfigs) {
      let user = await prisma.user.findUnique({
        where: { email: userConfig.email },
      });
      if (!user) {
        const hash = await bcrypt.hash(testUserPass, 10);
        user = await prisma.user.create({
          data: {
            email: userConfig.email,
            fullName: userConfig.name,
            passwordHash: hash,
            orgId: org.id,
            isSuperAdmin: false,
          },
        });
      }
      usersByOrg[org.id].push(user);

      // Assign role
      const role = rolesByOrg[org.id][userConfig.role];
      if (role) {
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: user.id, roleId: role.id } },
          update: {},
          create: { userId: user.id, roleId: role.id },
        });
      }
    }
  }

  // Create courses and lessons
  console.log("📚 Creating test courses and lessons...");
  const coursesByOrg: Record<number, any[]> = {};

  for (const org of [demoOrg, ...orgs]) {
    coursesByOrg[org.id] = [];

    const courseConfigs = [
      {
        courseCode: "PROG101",
        courseName: "Introduction to Programming",
        description: "Learn the basics of programming",
        lessons: ["Variables", "Functions", "Loops"],
      },
      {
        courseCode: "WEB201",
        courseName: "Web Development",
        description: "Build responsive web applications",
        lessons: ["HTML Basics", "CSS Styling", "JavaScript"],
      },
      {
        courseCode: "DATA301",
        courseName: "Data Science 101",
        description: "Introduction to data science and analytics",
        lessons: ["Data Collection", "Data Cleaning", "Visualization"],
      },
    ];

    for (const courseConfig of courseConfigs) {
      let course = await prisma.course.findUnique({
        where: { courseCode: courseConfig.courseCode },
      });

      if (!course) {
        course = await prisma.course.create({
          data: {
            courseCode: courseConfig.courseCode,
            courseName: courseConfig.courseName,
            description: courseConfig.description,
            source: "PLATFORM",
            visibility: "PUBLIC",
          },
        });

        // Create a level for the course
        const level = await prisma.level.create({
          data: {
            courseId: course.id,
            name: "Beginner",
            sequence: 1,
            description: "Beginner level",
          },
        });

        // Create lessons
        for (let i = 0; i < courseConfig.lessons.length; i++) {
          await prisma.lesson.create({
            data: {
              courseId: course.id,
              levelId: level.id,
              name: courseConfig.lessons[i],
              sequence: i + 1,
              description: `${courseConfig.lessons[i]} lesson`,
              durationMins: Math.floor(Math.random() * 120) + 10,
              contentType: "VIDEO",
              contentUrl: `https://example.com/video/${course.courseCode}/${i + 1}`,
            },
          });
        }
      }

      coursesByOrg[org.id].push(course);
    }
  }

  // Create robots with different license statuses
  console.log("🤖 Creating test robots...");
  const robotsByOrg: Record<number, any[]> = {};
  const licenseStatuses = [
    LicenseStatus.ACTIVE,
    LicenseStatus.EXPIRING_SOON,
    LicenseStatus.EXPIRED,
    LicenseStatus.REVOKED,
  ];

  function licenseWindow(status: LicenseStatus) {
    const now = new Date();
    let validUntil = new Date(now);
    let revokedAt: Date | null = null;

    if (status === LicenseStatus.ACTIVE) {
      validUntil = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    } else if (status === LicenseStatus.EXPIRING_SOON) {
      validUntil = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    } else if (status === LicenseStatus.EXPIRED) {
      validUntil = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    } else if (status === LicenseStatus.REVOKED) {
      validUntil = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      revokedAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    }

    return {
      validFrom: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000),
      validUntil,
      revokedAt,
    };
  }

  for (const org of [demoOrg, ...orgs]) {
    robotsByOrg[org.id] = [];

    for (let i = 0; i < 4; i++) {
      const status = licenseStatuses[i];
      let robot = await prisma.robot.findFirst({
        where: {
          orgId: org.id,
          serialNumber: `ROBOT-${org.id}-${i + 1}`,
        },
      });

      if (!robot) {
        const window = licenseWindow(status);

        const licenseKey = `WHRB${String(org.id).padStart(3, "0")}${String(i + 1).padStart(3, "0")}`;
        const hardware = hardwareProfileData(
          (["MINI_ELF", "ELF", "NANO", "S5"] as const)[i],
        );

        robot = await prisma.robot.create({
          data: {
            orgId: org.id,
            serialNumber: `ROBOT-${org.id}-${i + 1}`,
            name: `Robot ${i + 1} (${status})`,
            ...protectedLicenseData(licenseKey),
            validFrom: window.validFrom,
            validUntil: window.validUntil,
            licenseStatus: status,
            revokedAt: window.revokedAt,
            hardwareModel: hardware.hardwareModel,
            hardwareProfile: hardware.hardwareProfile ?? Prisma.JsonNull,
            hardwareCapabilities:
              hardware.hardwareCapabilities ?? Prisma.JsonNull,
          },
        });
      }

      robotsByOrg[org.id].push(robot);
    }
  }

  const inactiveRobotOrg =
    (await prisma.organization.findFirst({
      where: { name: "Robot Login Inactive Test Org" },
    })) ??
    (await prisma.organization.create({
      data: {
        name: "Robot Login Inactive Test Org",
        state: "Maharashtra",
        city: "Mumbai",
        authorizedPersonName: "Inactive Robot Tester",
        contactNo: "9876543299",
        isActive: false,
      },
    }));

  if (inactiveRobotOrg.isActive) {
    await prisma.organization.update({
      where: { id: inactiveRobotOrg.id },
      data: { isActive: false },
    });
  }

  const stableRobotCases = [
    {
      orgId: demoOrg.id,
      serialNumber: "TEST-ACTIVE-001",
      name: "API Test Robot (ACTIVE)",
      licenseKey: "WHRB900001",
      status: LicenseStatus.ACTIVE,
      hardwareModel: "MINI_ELF" as const,
    },
    {
      orgId: demoOrg.id,
      serialNumber: "TEST-EXPIRED-001",
      name: "API Test Robot (EXPIRED)",
      licenseKey: "WHRB900002",
      status: LicenseStatus.EXPIRED,
      hardwareModel: "ELF" as const,
    },
    {
      orgId: demoOrg.id,
      serialNumber: "TEST-REVOKED-001",
      name: "API Test Robot (REVOKED)",
      licenseKey: "WHRB900003",
      status: LicenseStatus.REVOKED,
      hardwareModel: "NANO" as const,
    },
    {
      orgId: inactiveRobotOrg.id,
      serialNumber: "TEST-INACTIVE-ORG-001",
      name: "API Test Robot (INACTIVE ORG)",
      licenseKey: "WHRB900004",
      status: LicenseStatus.ACTIVE,
      hardwareModel: "S5" as const,
    },
  ];

  for (const testRobot of stableRobotCases) {
    const window = licenseWindow(testRobot.status);
    const hardware = hardwareProfileData(testRobot.hardwareModel);
    const robot = await prisma.robot.upsert({
      where: { serialNumber: testRobot.serialNumber },
      update: {
        orgId: testRobot.orgId,
        name: testRobot.name,
        ...protectedLicenseData(testRobot.licenseKey),
        validFrom: window.validFrom,
        validUntil: window.validUntil,
        licenseStatus: testRobot.status,
        revokedAt: window.revokedAt,
        hardwareModel: hardware.hardwareModel,
        hardwareProfile: hardware.hardwareProfile ?? Prisma.JsonNull,
        hardwareCapabilities: hardware.hardwareCapabilities ?? Prisma.JsonNull,
      },
      create: {
        orgId: testRobot.orgId,
        serialNumber: testRobot.serialNumber,
        name: testRobot.name,
        ...protectedLicenseData(testRobot.licenseKey),
        validFrom: window.validFrom,
        validUntil: window.validUntil,
        licenseStatus: testRobot.status,
        revokedAt: window.revokedAt,
        hardwareModel: hardware.hardwareModel,
        hardwareProfile: hardware.hardwareProfile ?? Prisma.JsonNull,
        hardwareCapabilities: hardware.hardwareCapabilities ?? Prisma.JsonNull,
      },
    });

    if (testRobot.orgId === demoOrg.id) {
      robotsByOrg[demoOrg.id].push(robot);
    }
  }

  console.log(
    "✅ Stable robot API test serials: TEST-ACTIVE-001, TEST-EXPIRED-001, TEST-REVOKED-001, TEST-INACTIVE-ORG-001",
  );

  // Create usage logs (offline-first, will be accumulated)
  console.log("📊 Creating test usage logs...");
  for (const org of [demoOrg, ...orgs]) {
    const courses = coursesByOrg[org.id];
    const robots = robotsByOrg[org.id];

    for (let i = 0; i < 50; i++) {
      const course = courses[Math.floor(Math.random() * courses.length)];
      const lessons = await prisma.lesson.findMany({
        where: { courseId: course.id },
      });
      const lesson = lessons[Math.floor(Math.random() * lessons.length)];
      const robot = robots[Math.floor(Math.random() * robots.length)];

      const daysAgo = Math.floor(Math.random() * 30);
      const timestamp = new Date();
      timestamp.setDate(timestamp.getDate() - daysAgo);
      timestamp.setHours(
        Math.floor(Math.random() * 24),
        Math.floor(Math.random() * 60),
        0,
        0,
      );

      await prisma.robotUsageLog.create({
        data: {
          orgId: org.id,
          robotId: robot.id,
          courseId: course.id,
          lessonId: lesson.id,
          eventId: `${robot.id}-${org.id}-${i}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          openedAt: timestamp,
          durationSec: Math.floor(Math.random() * 3600) + 300,
        },
      });
    }
  }

  // Create notifications
  console.log("🔔 Creating test notifications...");
  for (const org of [demoOrg, ...orgs]) {
    // License expiration notifications
    const expiringRobots = robotsByOrg[org.id].filter((r) => {
      const daysUntil =
        (r.validUntil.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
      return daysUntil > 0 && daysUntil <= 30;
    });

    for (const robot of expiringRobots) {
      const daysLeft = Math.ceil(
        (robot.validUntil.getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24),
      );
      const existing = await prisma.notification.findFirst({
        where: {
          orgId: org.id,
          type: "LICENSE_EXPIRING",
        },
      });

      if (!existing) {
        await prisma.notification.create({
          data: {
            orgId: org.id,
            type: "LICENSE_EXPIRING",
            title: "License Expiring Soon",
            message: `Robot ${robot.serialNumber} license expires in ${daysLeft} days`,
            payload: {
              robotId: robot.id,
              validUntil: robot.validUntil.toISOString(),
            },
          },
        });
      }
    }

    // System notifications
    const notificationTypes = [
      {
        type: "SYSTEM",
        title: "System Update",
        message: "A new system update is available",
      },
      {
        type: "CONTENT_UPDATE",
        title: "Content Update",
        message: "New courses have been added to your organization",
      },
      {
        type: "USER_ALERT",
        title: "User Alert",
        message: "A new user has joined your organization",
      },
    ];

    for (const notif of notificationTypes) {
      const existing = await prisma.notification.findFirst({
        where: {
          orgId: org.id,
          type: notif.type,
        },
      });

      if (!existing) {
        await prisma.notification.create({
          data: {
            orgId: org.id,
            type: notif.type,
            title: notif.title,
            message: notif.message,
            payload: {},
          },
        });
      }
    }
  }

  console.log("✅ Comprehensive seed data created");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
