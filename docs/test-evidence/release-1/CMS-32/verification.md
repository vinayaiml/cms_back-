# CMS-32 Verification

## Scope

Ticket: Add organization active/inactive status enforcement across user auth and robot APIs.

## Automated Coverage

- User login rejects non-superadmin users when their organization is inactive.
- User login does not issue a JWT for inactive organizations.
- User login audit events store `ORG_INACTIVE` and hashed request metadata only.
- Super Admin login remains available without organization scope.
- Existing robot coverage verifies inactive organization rejection for robot login and refresh.
- Existing robot sync and usage-log coverage verifies `423 Locked` for inactive organizations.

## Manual Verification Matrix

Use sanitized test tenants only.

| Case | Expected Result |
| --- | --- |
| Active organization user login | `201 Created` with user token |
| Inactive organization user login | `423 Locked`, no token |
| Super Admin login | `201 Created` with user token |
| Active organization robot login | `201 Created` with robot access token |
| Inactive organization robot login | `423 Locked`, no token |
| Inactive organization robot sync | `423 Locked` |
| Inactive organization robot log upload | `423 Locked` |

## Security Notes

- Passwords are accepted only in login request bodies and are never written to audit metadata.
- JWTs, refresh tokens, raw license keys and protected license material are not written to logs or evidence.
- Rejections use controlled reason codes such as `ORG_INACTIVE`.

## Commands

```text
npm run prisma:generate
npm run build
npm run test:unit
git diff --check
```

Integration tests require `TEST_DATABASE_URL` pointing to an isolated test database.
