# CMS-33 Verification

## Scope

Ticket: Add user lock/unlock with audit event and organization branding/context contract.

## Automated Coverage

- Authorized administrators can explicitly lock and unlock users.
- User lock/unlock writes sanitized audit events with `user.locked` and `user.unlocked`.
- Cross-tenant direct-ID lock attempts are rejected before mutation.
- Self-lock attempts are rejected.
- Locked users are already denied during login by `AuthService`.
- Robot sync returns safe organization context for the authenticated robot tenant.
- Two organization contexts return distinct values without cross-tenant leakage.

## Safe Organization Context

Robot-authenticated sync responses include:

```json
{
  "organization": {
    "orgId": 1,
    "orgName": "Demo School",
    "displayName": "Demo School",
    "logoUrl": "https://assets.whizrobo.test/orgs/demo-school-logo.png",
    "primaryColor": "#1D4ED8",
    "secondaryColor": "#F97316",
    "tenantVersion": 1,
    "cacheVersion": "org-1-v1"
  }
}
```

`authorizedPersonName` and `contactNo` are intentionally excluded from robot/app responses.

## Manual Verification Matrix

| Case | Expected Result |
| --- | --- |
| Authorized admin locks a same-tenant user | User becomes locked and audit event is created |
| Authorized admin unlocks a same-tenant user | User becomes unlocked and audit event is created |
| Locked user login | Login is denied immediately |
| Unauthorized lock attempt | `403 Forbidden` |
| Cross-tenant direct-ID lock attempt | `403 Forbidden`, no mutation |
| Inactive organization robot sync | `423 Locked` |
| Active robot sync for org A and org B | Distinct safe `organization` objects |

## Security Notes

- Passwords, JWTs, refresh tokens, license keys and protected license material are not returned in organization context.
- Lock/unlock audit metadata stores status transitions only.
- Robot organization context excludes private contact fields unless explicitly approved later.

## Commands

```text
npm run prisma:generate
npm run build
npm run test:unit
git diff --check
```

Integration tests require `TEST_DATABASE_URL` pointing to an isolated test database.
