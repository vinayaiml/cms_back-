# CMS-31 Verification

Ticket: Verify organization CRUD never exposes credentials or cross-tenant data

Date: 2026-09-15
Repository: CMS
Scope: Backend organization CRUD and tenant-isolation safeguards

## Summary

- Organization CRUD responses are selected through an explicit safe field list.
- Organization response fields exclude password, password hash, token, secret and license-key data.
- Super Admin remains the only role allowed to use organization CRUD routes.
- Organization admins are blocked before service calls run when attempting direct-ID organization access.
- Robot tokens are blocked from organization administration routes.
- Credential-like fields in organization create requests are rejected by request validation.

## Automated Coverage

- `backend/src/modules/orgs/orgs.controller.spec.ts`
  - Super Admin can receive safe organization list responses.
  - `password` and `adminPassword` request fields are rejected for organization creation.
  - Organization admin direct-ID reads are rejected.
  - Organization admin direct-ID updates are rejected.
  - Organization admin direct-ID deletes and active-state changes are rejected.
  - Robot tokens are rejected from organization administration routes.

- `backend/src/modules/orgs/orgs.service.spec.ts`
  - Organization list queries use an explicit safe Prisma selection.
  - The selection does not include credential or license-secret fields.
  - Organization deactivation still records the expected critical audit event.

## Manual Verification Notes

- Do not commit real credentials, tokens, database URLs or customer data as evidence.
- Direct-ID checks should be repeated in integration with:
  - a Super Admin user token,
  - an organization admin token,
  - a robot access token,
  - at least two organizations.

## Pending

- Live integration verification is pending until an isolated integration test database/environment is available.
