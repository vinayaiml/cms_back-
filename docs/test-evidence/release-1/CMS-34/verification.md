# CMS-34 Verification

## Scope

Enforce the organization permission ceiling for role permission assignment, direct user permission assignment, and effective permission calculation.

## Implemented checks

- Role permissions are rejected when the permission is not approved for the role organization.
- Direct user permissions are rejected when any requested permission is outside the target user's organization ceiling.
- `permission.manage` does not bypass the organization permission ceiling.
- Direct-ID role assignment across tenant boundaries is rejected before mutation.
- Effective permission calculation in the runtime guard is capped by the user's organization-approved permissions.
- Super Admin can continue global organization permission administration through the existing organization permission APIs.

## Security notes

- Rejection messages are safe and do not include secrets, tokens, passwords, or license values.
- No credentials or prohibited personal data were added to fixtures, logs, or client responses.
- Stale database rows that exceed an organization's current permission policy do not become effective permissions.

## Suggested verification commands

```bash
cd backend
npm run prisma:generate
npm run build
npm run test:unit -- roles.service.spec.ts users.service.spec.ts permissions.guard.spec.ts
```

## Manual API paths

- `POST /api/roles/:id/permissions`
- `POST /api/users/:id/permissions`
- `POST /api/users/:id/roles`
- Any protected endpoint using `PermissionsGuard`

## Expected outcomes

- Role cannot receive a permission unavailable to its organization.
- User direct permissions cannot include permissions unavailable to the user's organization.
- Cross-tenant direct-ID attempts are rejected before mutation.
- Effective permissions never exceed the organization's approved permission set.
