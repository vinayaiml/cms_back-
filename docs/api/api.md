# WhizRobot CMS API Usage Guide

This document explains how to use the versioned CMS API routes added for CMS-17.
The official API contract remains `docs/api/openapi.yaml`.

## Base URLs

Local backend:

```text
http://localhost:3001/api
```

Version 1 baseline:

```text
http://localhost:3001/api/v1
```

Swagger UI:

```text
http://localhost:3001/api/docs
```

Raw OpenAPI YAML:

```text
http://localhost:3001/api/docs/openapi.yaml
```

## Versioning Rules

New Android, CMS frontend, and backend integrations should use `/api/v1`.

Approved legacy test routes still work temporarily, but they are deprecated:

| Legacy route | Version 1 route |
| --- | --- |
| `POST /api/auth/login` | `POST /api/v1/auth/login` |
| `POST /api/robot/auth/login` | `POST /api/v1/robot/auth/login` |
| `GET /api/robot/sync` | `GET /api/v1/robot/sync` |
| `POST /api/robot/logs/batch` | `POST /api/v1/robot/logs/batch` |

Legacy routes log a warning in the backend terminal:

```text
[legacy-api] <METHOD> <route> is deprecated; use /api/v1. Planned removal: v2.
```

Planned legacy removal: API v2.

## Authentication Headers

User APIs use a user JWT:

```text
Authorization: Bearer <user-token>
```

Robot APIs use a robot JWT:

```text
Authorization: Bearer <robot-token>
```

Do not use the user token for robot sync or robot log upload. Those routes require a robot token.

## User Login

Use this route for CMS users and administrators.

```text
POST http://localhost:3001/api/v1/auth/login
```

Body:

```json
{
  "email": "superadmin@whizrobo.com",
  "password": "<password>"
}
```

Success response:

```json
{
  "token": "<user-jwt>",
  "user": {
    "id": 1,
    "email": "superadmin@whizrobo.com",
    "fullName": "Super Admin",
    "orgId": null,
    "isSuperAdmin": true
  }
}
```

Expected status:

```text
201 Created
```

## Robot Login

Use this route to exchange a robot activation value and serial number for a robot JWT.
CMS stores the provided safe device metadata on successful login.

```text
POST http://localhost:3001/api/v1/robot/auth/login
```

Body:

```json
{
  "licenseKey": "<license-key>",
  "serialNumber": "WR-001",
  "deviceMetadata": {
    "manufacturer": "Sanbot",
    "model": "Mini ELF",
    "androidVersion": "7.1.2",
    "apiLevel": 25,
    "appVersionName": "0.1.0",
    "appVersionCode": 2
  },
  "deviceMetadataConsent": true
}
```

Success response:

```json
{
  "token": "<robot-jwt>",
  "robot": {
    "id": 1,
    "orgId": 1,
    "serialNumber": "ROBOT-1-1",
    "name": "Robot 1 (ACTIVE)"
  },
  "license": {
    "validFrom": "2026-02-28T11:26:06.106Z",
    "validUntil": "2026-11-25T11:26:06.106Z",
    "status": "ACTIVE",
    "locked": false
  }
}
```

Expected status:

```text
201 Created
```

Invalid license keys and serial-number mismatches return:

```text
401 Unauthorized
```

Expired licenses, revoked licenses and inactive organizations return:

```text
423 Locked
```

Example:

```json
{
  "error": {
    "code": "ORG_INACTIVE",
    "message": "Organization is inactive",
    "locked": true
  }
}
```

CMS stores only a consent flag, app version fields, API level and one-way digests of the device identity fields. Raw license keys, JWTs and raw device identity metadata are not returned by this API.

Authorized CMS administrators can erase stored robot device metadata:

```text
DELETE http://localhost:3001/api/robots/{id}/device-metadata
Authorization: Bearer <user-token>
X-Correlation-Id: <request-id>
```

## Robot Sync

Use this route after robot login. It returns the robot configuration and available content.

```text
GET http://localhost:3001/api/v1/robot/sync
```

Headers:

```text
Authorization: Bearer <robot-token>
```

Success response:

```json
{
  "locked": false,
  "license": {
    "status": "ACTIVE",
    "validFrom": "2026-02-28T11:26:06.106Z",
    "validUntil": "2026-11-25T11:26:06.106Z"
  },
  "myCourses": [],
  "publicCatalog": [],
  "syncedAt": "2026-08-31T06:41:24.929Z"
}
```

Expected status:

```text
200 OK
```

## Robot Logs Batch

Use this route to upload usage logs from the robot.

```text
POST http://localhost:3001/api/v1/robot/logs/batch
```

Headers:

```text
Authorization: Bearer <robot-token>
Content-Type: application/json
```

Body:

```json
{
  "logs": [
    {
      "eventId": "thunder-test-001",
      "courseId": 1,
      "lessonId": 1,
      "openedAt": "2026-08-31T10:00:00.000Z",
      "durationSec": 60
    }
  ]
}
```

Minimal body:

```json
{
  "logs": [
    {
      "eventId": "thunder-test-001",
      "openedAt": "2026-08-31T10:00:00.000Z",
      "durationSec": 60
    }
  ]
}
```

Success response:

```json
{
  "inserted": 1
}
```

Expected status:

```text
201 Created
```

If the same `eventId` is sent again, the API may return:

```json
{
  "inserted": 0
}
```

That means the request was accepted, but the log already existed.

## Thunder Client Verification

1. Login as a CMS user:

```text
POST http://localhost:3001/api/v1/auth/login
```

2. Login as a robot:

```text
POST http://localhost:3001/api/v1/robot/auth/login
```

3. Copy the robot token from robot login.

4. Call robot sync:

```text
GET http://localhost:3001/api/v1/robot/sync
Authorization: Bearer <robot-token>
```

5. Upload robot logs:

```text
POST http://localhost:3001/api/v1/robot/logs/batch
Authorization: Bearer <robot-token>
Content-Type: application/json
```

6. Repeat the same requests against the legacy routes and confirm they still work.

7. Check the backend terminal for legacy deprecation warnings.

## Android Mock Fixture Trace

Android mock fixtures should map to the OpenAPI examples by operation ID:

| Operation ID | Route | Fixture purpose |
| --- | --- | --- |
| `loginUserV1` | `POST /api/v1/auth/login` | CMS user/admin login success and credential failures |
| `loginRobotV1` | `POST /api/v1/robot/auth/login` | Robot activation login success, invalid license or serial, expired license, revoked license and inactive organisation |
| `syncRobotV1` | `GET /api/v1/robot/sync` | Active robot configuration, locked license and inactive organisation |
| `uploadRobotLogsBatchV1` | `POST /api/v1/robot/logs/batch` | New log upload, duplicate retry and validation errors |

Use the `/api/v1` examples as the fixture source. Legacy examples exist only to verify temporary backwards compatibility.

## Common Errors

Missing or invalid token:

```json
{
  "message": "No auth token",
  "error": "Unauthorized",
  "statusCode": 401
}
```

Wrong request body:

```json
{
  "message": [
    "logs must be an array"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

Inactive organization:

```json
{
  "error": {
    "code": "ORG_INACTIVE",
    "message": "Organization is inactive",
    "locked": true
  }
}
```

## Notes for New Development

- Use `/api/v1` for new work.
- Keep request and response changes in sync with `docs/api/openapi.yaml`.
- Do not add new unversioned routes for Android or CMS integrations.
- Do not rely on legacy routes except for approved temporary test integrations.
- Treat JWTs and license keys as secrets.
