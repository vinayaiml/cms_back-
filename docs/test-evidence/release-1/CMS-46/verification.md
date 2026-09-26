# CMS-46 Verification

Ticket: Create subscription-plan and plan-capability schema.

## Scope

- Added subscription plan and plan-capability persistence schema.
- Added protected subscription plan APIs for list/get/create/update/disable and idempotent capability replacement.
- Seeded deterministic F04 baseline plans mapped to the capability catalog.
- Updated OpenAPI/API docs with success and failure response contracts.

## Security Notes

- Mutation endpoints require user JWT plus `subscription.manage` and Super Admin.
- Read endpoints require `subscription.read`.
- Plan responses return configured capability catalog entries only.
- No robot credentials, license keys, JWTs or protected secret fields are returned or logged by this change.

## Verification Commands

```text
npm run prisma:generate
npx jest --config jest.unit.config.js --runTestsByPath src/modules/subscription-plans/subscription-plans.service.spec.ts src/modules/subscription-plans/subscription-plans.controller.spec.ts --runInBand
npm run build
npm run test:unit
python -c "import yaml; yaml.safe_load(open('docs/api/openapi.yaml', encoding='utf-8'))"
git diff --check
```

## Expected Results

- Plan CRUD validates unique stable keys.
- A plan returns exactly its configured active capability set.
- Unknown or inactive capability references are rejected before persistence.
- Organization-scoped admins are rejected before subscription plan mutation.
