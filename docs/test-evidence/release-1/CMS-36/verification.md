# CMS-36 Verification

## Scope

Add safe, actionable validation and error display for CMS user and role administration.

## Changes Verified

- Duplicate role creation now returns a safe conflict message: `Role name already exists in this organization`.
- Role names are trimmed before persistence.
- CMS API errors are parsed into safe UI messages instead of raw JSON response bodies.
- Users UI adds actionable guidance for role permission ceiling, cross-tenant and unauthorized user actions.
- Roles UI adds actionable guidance for duplicate role names, permission ceiling and cross-tenant role actions.
- No secrets, tokens, license keys or database URLs were added in the CMS-36 diff.

## Commands Run

- `cd backend && npm run test:unit -- --runTestsByPath src/modules/roles/roles.service.spec.ts src/modules/users/users.service.spec.ts`
  - Result: PASS, 2 suites, 11 tests.
- `cd backend && npm run build`
  - Result: PASS.
- `cd frontend && npm run typecheck`
  - Result: PASS.
- `git diff --check -- backend/src/modules/roles/roles.service.ts backend/src/modules/roles/roles.service.spec.ts frontend/lib/api.ts frontend/lib/api.test.ts frontend/app/(dashboard)/users/page.tsx frontend/app/(dashboard)/roles/page.tsx`
  - Result: PASS.
- Targeted secret-pattern scan on the CMS-36 diff
  - Result: PASS.

## Environment-Limited Checks

- `cd frontend && npm run test -- --run frontend/lib/api.test.ts`
  - Blocked in WSL by the existing Windows/WSL Rollup optional dependency binary issue: invalid ELF header for `@rollup/rollup-linux-x64-gnu`.
- `cd frontend && npm run lint`
  - Started but hung without output in this WSL session and was stopped.
- `cd backend && npm run test:unit`
  - Service suites passed, but controller suites using Supertest failed in this sandbox with `listen EPERM: operation not permitted 0.0.0.0`.

## Manual Verification Targets

- Duplicate user email should display `Email already exists`.
- Duplicate role name should display `A role with this name already exists in this organization. Use a different role name.`
- Unavailable permission should display guidance to ask a Super Admin to update the organization permission ceiling.
- Cross-tenant direct-ID attempts should display an authorization/own-organization message without exposing internal details.
