# CMS-68 Verification

- Added explicit course and lesson `isPublished` delivery flags.
- Added course and lesson publish/unpublish endpoints protected by `content.write`.
- Publish/unpublish writes sanitized audit events with actor, target content and old/new publish state.
- Robot sync and CMS manifest preview filter unpublished courses and lessons from new manifests.
- Signed content delivery rejects links when the target course or lesson has been unpublished after token issuance.
- No token, license key, credential secret or prohibited PII is returned or written in audit metadata.

Verification not run by request.
