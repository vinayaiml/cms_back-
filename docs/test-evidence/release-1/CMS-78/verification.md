# CMS-78 Verification - Identity Retention Expiry and Deletion Job

## Scope

- Added `retentionExpiresAt` metadata for identity embedding records.
- Added identity retention scan to the existing jobs service.
- Expired active identity records are marked `DELETED`, protected ciphertext/fingerprint data is cleared, and a sanitized audit event is recorded.
- The scan is idempotent through conditional `updateMany` filtering.

## Security Notes

- Retention audit metadata does not include raw embeddings, ciphertext, tokens, license keys or provider secrets.
- Unsafe legacy subject references are redacted in retention audit metadata.

## Local Verification

- Suggested checks:
  - `cd D:\CMS_V1\CMS_Back && npm run prisma:generate`
  - `cd D:\CMS_V1\CMS_Back && npm run build`
