# CMS-52 Verification - Capability Catalogue and Plan Management UI

## Scope

CMS-52 adds the CMS dashboard UI for capability catalogue review and subscription plan management. The UI uses the existing backend capability and subscription-plan APIs and keeps backend validation as the source of truth.

## Expected Behavior

- Authorized Super Admin can create and edit capabilities.
- Authorized Super Admin can create and edit subscription plans.
- Plan capability membership is saved exactly as selected from the active capability catalogue.
- Read-only users with `subscription.read` can view active capabilities and plans but cannot mutate them.
- Duplicate stable keys, invalid stable key format, missing required fields and unauthorized actions show safe validation feedback.
- UI messages do not include license keys, JWTs, credentials, private URLs, stack traces or prohibited PII.
- Dashboard navigation exposes the Plans page for users with `subscription.read`, with a backend fallback for existing databases where the dashboard section has not been seeded yet.

## Covered Files

- `CMS_Front/frontend/app/(dashboard)/subscription-plans/page.tsx`
- `CMS_Front/frontend/lib/subscription-plan-ui.ts`
- `CMS_Front/frontend/lib/subscription-plan-ui.test.ts`
- `CMS_Back/src/modules/dashboard/dashboard.service.ts`
- `CMS_Back/prisma/seed.ts`

## Verification Commands

```text
cd CMS_Front/frontend && npm run test
cd CMS_Front/frontend && npm run typecheck
cd CMS_Front/frontend && npm run build
cd CMS_Front/frontend && npm run lint
cd CMS_Back && npm run build
cd CMS_Back && npm run test:unit
git diff --check -- <CMS-52 files>
```

## Results

PASS.

- `npm run test` passed: 4 files, 10 tests.
- `npm run typecheck` passed.
- `npm run build` passed and generated `/subscription-plans`.
- `npm run lint` passed with existing warnings outside the CMS-52 page.
- `npm run build` in backend passed.
- `npm run test:unit` in backend passed: 23 suites, 146 tests.
- Focused `git diff --check` passed in both CMS_V1 backend and frontend repositories.
- No OpenAPI route/schema change was required because CMS-52 consumes existing capability and subscription-plan APIs.
