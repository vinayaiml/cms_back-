# CMS-37 Verification

## Scope

Add automated cross-tenant authorization regression tests for F02 organization, user, role, permission, robot and robot-context paths.

## Changes Verified

- Organization-scoped users cannot read another tenant's user or role lists by passing an `orgId` query override.
- Organization direct-ID administration routes reject non-Super Admin actors before service mutation calls.
- Cross-tenant user update, delete, lock and direct-permission mutations are rejected before persistence.
- Cross-tenant role permission add/remove attempts are rejected before permission lookup or persistence.
- Cross-tenant robot lock and license-renew attempts are rejected before mutation.
- Robot sync for an inactive organization throws the locked-domain error and does not return organization context/content.
- Test fixtures use synthetic IDs and emails only.
- No credentials, tokens, license keys or database URLs were added in CMS-37 changes.

## Commands Run

- `cd backend && npm run test:unit -- --runTestsByPath src/modules/tenant-isolation/tenant-isolation.spec.ts src/modules/users/users.service.spec.ts src/modules/roles/roles.service.spec.ts src/modules/robots/robots.service.spec.ts src/modules/robot-sync/robot-sync.service.spec.ts`
  - Result: PASS, 5 suites, 33 tests.
- `git diff --check -- backend/src/modules/tenant-isolation/tenant-isolation.spec.ts`
  - Result: PASS.

## Manual Verification Targets

- Same-tenant reads and mutations should continue through existing service/controller paths.
- Unauthorized, forbidden, locked/inactive organization and cross-tenant direct-ID paths should fail with safe messages.
- Backend test command returns a non-zero exit code if any CMS-37 regression assertion fails.
