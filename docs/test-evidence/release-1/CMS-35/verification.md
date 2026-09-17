# CMS-35 Verification

## Scope

Add organization status and permission-summary visibility in CMS, and support authorized robot reassignment with tenant cache reset.

## Implemented behavior

- Organization list shows active/inactive status.
- Organization list shows permission summaries loaded from backend organization permission APIs.
- Permission summary displays the backend-enforced organization permission ceiling from CMS-34.
- Super Admin can reassign a robot to another organization from the robot management page.
- Robot reassignment updates the robot `orgId`.
- Robot reassignment increments tenant versions for the old and new organizations.
- Robot reassignment to an inactive target organization is rejected before mutation.
- The next robot sync reads the robot's current organization and returns the new organization context/cacheVersion.
- Robot reassignment creates a sanitized `robot.reassigned` audit event.

## Security notes

- Robot reassignment is Super Admin-only.
- Organization-scoped users are rejected before mutation.
- Reassignment responses and audit metadata do not include license keys, tokens, passwords or credential material.
- Organization context returned to robot sync remains limited to approved display fields.

## Suggested verification commands

```bash
cd backend
npm run prisma:generate
npm run build
npm run test:unit -- robots.service.spec.ts robot-sync.service.spec.ts --runInBand

cd ../frontend
npm run build
```

## Manual API checks

- `GET /api/orgs` shows active/inactive state.
- `GET /api/orgs/:id/permissions` returns the permission ceiling displayed by the CMS UI.
- `PATCH /api/robots/:id/reassign` with Super Admin succeeds.
- `PATCH /api/robots/:id/reassign` with an organization-scoped user returns 403.
- `PATCH /api/robots/:id/reassign` to an inactive organization returns 403.
- `GET /api/v1/robot/sync` after reassignment returns the new organization context and changed cacheVersion.

## Expected outcomes

- Admin can view correct organization status.
- Admin can view correct effective organization permissions.
- Same robot reassigned from Organization A to Organization B syncs with Organization B context.
- Old Organization A context/content is not returned after reassignment.
- Cache version changes after reassignment.
