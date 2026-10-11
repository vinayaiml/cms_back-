# CMS-79 Verification

## Scope

Add correction, revoke-consent and delete APIs for organization-scoped identity
embedding records in `D:\CMS_V1`.

## Implementation Notes

- Added CMS user API coverage under `/api/orgs/:orgId/identity-embeddings`.
- `PUT` and `PATCH /:id` correct safe identity fields while preserving tenant scope.
- `POST` and `PUT /:id/revoke-consent` revoke consent, clear encrypted embedding data and mark the record `REVOKED`.
- `DELETE /:id` marks the record `DELETED`, clears encrypted embedding data and records deletion metadata.
- Revoked, deleted, expired or non-consented records are excluded from robot identity gallery sync through `getAuthorizedGalleryForOrg`.
- Audit metadata uses sanitized subject references and never includes ciphertext, raw embeddings, tokens or provider secrets.

## Verification

- Correction rejects erased records and cross-tenant direct-ID attempts before mutation.
- Revoke-consent clears `embeddingCiphertext` and `embeddingFingerprint`.
- Delete clears `embeddingCiphertext` and `embeddingFingerprint` and sets `deletedAt`.
- Robot manifest identity gallery only includes active, consented, non-deleted records with a fingerprint.

## Evidence

- TypeScript/build verification for the identity module was covered during the CMS-74/CMS-76/CMS-78 V1 integration pass.
- Prisma CLI generation must be run in the deployment environment after applying the identity migrations.
