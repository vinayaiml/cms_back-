# CMS-76 Verification - Consent, Identity and Encrypted Embedding Metadata

## Scope

- Added `IdentityEmbeddingRecord` schema and migration.
- Added organization-scoped identity embedding APIs under `/api/orgs/:orgId/identity-embeddings`.
- Identity creation requires explicit granted consent.
- Embedding metadata is encrypted at rest and normal responses return only safe metadata/fingerprint.
- Robot manifests include an organization-scoped identity gallery generated from active, consented, non-deleted records.

## Security Notes

- Raw embedding metadata and ciphertext are never returned.
- Subject references are validated to reject email-like, phone-like, token-like and secret-like values.
- Cross-tenant direct-ID access is rejected by backend tenant checks.

## Local Verification

- Suggested checks:
  - `cd D:\CMS_V1\CMS_Back && npm run prisma:generate`
  - `cd D:\CMS_V1\CMS_Back && npm run build`
