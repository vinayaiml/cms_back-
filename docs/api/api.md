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
| `POST /api/robot/auth/refresh` | `POST /api/v1/robot/auth/refresh` |
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

Robot APIs use the short-lived robot access token returned by robot login or refresh:

```text
Authorization: Bearer <robot-access-token>
```

Do not use the user token or robot refresh token for robot sync or robot log upload. Those routes require a robot access token.

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





## Organization Subscription Assignment

F04 organization subscriptions connect an organization to a configured subscription plan and validity window. Reads require `subscription.read`; assignment requires Super Admin with `subscription.manage`.

```text
PUT http://localhost:3001/api/orgs/7/subscription
Authorization: Bearer <user-token>
X-Correlation-Id: cms-47-check
```

Body:

```json
{
  "planId": 2,
  "status": "ACTIVE",
  "validFrom": "2026-09-01T00:00:00.000Z",
  "validUntil": "2027-09-01T00:00:00.000Z"
}
```

The assignment replaces the current organization subscription, increments `tenantVersion` for robot cache reset, and records a sanitized audit event. Invalid date windows, inactive plans and unauthorized direct-ID attempts return the shared safe error schema.

Robot sync returns the effective paid entitlement set under `entitlements`. If the subscription is missing, inactive, expired, not yet active, or linked to an inactive plan, `paidCapabilities` is empty.

```json
{
  "entitlements": {
    "subscription": {
      "status": "EXPIRED",
      "planId": 1,
      "planStableKey": "starter",
      "planVersion": 1,
      "validFrom": "2025-01-01T00:00:00.000Z",
      "validUntil": "2025-02-01T00:00:00.000Z"
    },
    "paidCapabilities": []
  }
}
```

Subscription assignment and robot sync entitlement responses never return robot license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.


## Organization Capability Overrides

F04 capability overrides let a Super Admin allow or deny one capability for one target organization without changing the global capability catalogue or subscription plan. Reads require `subscription.read`; writes require Super Admin with `subscription.manage`.

```text
PUT http://localhost:3001/api/orgs/7/capability-overrides
Authorization: Bearer <user-token>
X-Correlation-Id: cms-48-check
```

Body:

```json
{
  "capabilityStableKey": "speech.recognition",
  "effect": "DENY",
  "reason": "Temporarily disabled until microphone QA passes."
}
```

Success response:

```json
{
  "id": 11,
  "orgId": 7,
  "capabilityId": 3,
  "capabilityStableKey": "speech.recognition",
  "capabilityName": "Speech Recognition",
  "effect": "DENY",
  "reason": "Temporarily disabled until microphone QA passes.",
  "createdByUserId": 1,
  "createdAt": "2026-09-25T10:00:00.000Z",
  "updatedAt": "2026-09-25T10:00:00.000Z"
}
```

The override affects only the target organization, increments `tenantVersion` for robot cache reset, and records a sanitized audit event. Robot sync returns `paidCapabilities` after active subscription capabilities are adjusted by organization `ALLOW` and `DENY` overrides. Override APIs and audit metadata do not return license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.

## Subscription Plans

Subscription plan CRUD is available for F04 capability entitlement setup. Reads require `subscription.read`; mutations require Super Admin with `subscription.manage`.

```text
GET http://localhost:3001/api/subscription-plans
Authorization: Bearer <user-token>
```

A plan response returns exactly the active capabilities configured on that plan:

```json
{
  "id": 1,
  "stableKey": "starter",
  "name": "Starter",
  "description": "Baseline robot app capabilities for integration testing.",
  "version": 1,
  "isActive": true,
  "capabilities": [
    {
      "id": 1,
      "stableKey": "audio.speaker",
      "name": "Speaker Output",
      "category": "audio",
      "version": 1,
      "requiredHardware": {
        "capabilities": ["speaker"]
      },
      "isActive": true
    }
  ],
  "createdAt": "2026-09-24T00:00:00.000Z",
  "updatedAt": "2026-09-24T00:00:00.000Z"
}
```

Super Admin can create/update plans and replace capability membership idempotently:

```text
PUT http://localhost:3001/api/subscription-plans/1/capabilities
Authorization: Bearer <user-token>
```

```json
{
  "capabilityStableKeys": ["audio.speaker", "display.touch", "media.video-playback"]
}
```

Unknown, inactive or duplicate capability inputs are rejected or normalized before persistence. Plan APIs do not return robot credentials, license keys, JWTs or protected secret fields.

## Robot Login

Use this route to exchange a tester-entered robot activation value and the Sanbot robot ID for a robot JWT.
CMS stores the provided safe device metadata on successful login.
CMS also updates the robot `lastSeenAt`, `appVersion` and `deviceModel` fields from the validated login metadata.
The Android app sends the Sanbot robot ID in the `serialNumber` field.
The request rejects unknown metadata fields and invalid serial/license formats.
Raw license keys are never returned in login responses, logs or audit metadata. Robot credentials are stored as protected secrets. Robot list responses include license key display fields only for Super Admin, and the CMS frontend masks them by default until the eye button is clicked.

```text
POST http://localhost:3001/api/v1/robot/auth/login
```

Body:

```json
{
  "licenseKey": "WHRB900001",
  "serialNumber": "TEST-ACTIVE-001",
  "deviceMetadata": {
    "manufacturer": "Sanbot",
    "model": "Mini ELF",
    "androidVersion": "7.1.2",
    "apiLevel": 25,
    "appVersionName": "0.1.0",
    "appVersionCode": 2
  }
}
```

Success response:

```json
{
  "token": "<robot-access-jwt>",
  "accessToken": "<robot-access-jwt>",
  "refreshToken": "<robot-refresh-jwt>",
  "expiresIn": 900,
  "refreshExpiresIn": 604800,
  "tokenType": "Bearer",
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

## Robot Token Refresh

Use this route when the short-lived robot access token expires. Send only the refresh token. The refresh token is not accepted by robot sync or robot log upload.

```text
POST http://localhost:3001/api/v1/robot/auth/refresh
```

Body:

```json
{
  "refreshToken": "<robot-refresh-jwt>"
}
```

Success response:

```json
{
  "token": "<robot-access-jwt>",
  "accessToken": "<robot-access-jwt>",
  "expiresIn": 900,
  "tokenType": "Bearer",
  "robot": {
    "id": 1,
    "orgId": 1,
    "serialNumber": "TEST-ACTIVE-001",
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

Invalid or expired refresh tokens return:

```text
401 Unauthorized
```

Expired licenses, revoked licenses and inactive organizations return:

```text
423 Locked
```

Robot enrollment is the protected administrative `POST /api/robots` contract. It accepts the robot serial number, license window and optional validated hardware profile, generates the activation license key server-side in `WHRB` plus six digits format, stores it as a protected secret, records `robot.enrolled` audit metadata without the secret, and returns the activation `licenseKey` in the create response.

The F03 hardware profile stores metadata only. CMS validates the submitted model profile against approved `MINI_ELF`, `ELF`, `NANO` and `S5` policy values, stores the normalized `hardwareProfile`, and returns `hardwareCapabilities` as the effective permitted capability set. Safety-controlled capabilities such as autonomous navigation and arm motion resolve to `false` in F03 until later entitlement and safety-policy phases consume the stored metadata.

Duplicate robot serial numbers are rejected with `409 Conflict` before a new credential is generated or an enrollment audit event is written.

Robot list responses include `licenseKey` and `licenseKeyMasked` only for Super Admin. Organization users never receive robot license keys from the list API. The CMS frontend shows the masked value by default and reveals the raw value for five seconds when Super Admin clicks the eye button.

Fleet list filters are supported on `GET /api/robots`:

```text
GET http://localhost:3001/api/robots?orgId=1&status=ACTIVE&model=MINI_ELF&version=0.1.0&lastSeenFrom=2026-09-01T00:00:00.000Z&lastSeenTo=2026-09-21T00:00:00.000Z&limit=25
Authorization: Bearer <user-token>
```

Super Admin can use `orgId` to filter any tenant. Organization users are always scoped to their own tenant, and attempts to filter another `orgId` are rejected before querying. Normal organization-scoped responses still exclude license keys and protected license secret fields.

Robot detail is available through the protected administrative detail route:

```text
GET http://localhost:3001/api/robots/10
Authorization: Bearer <user-token>
```

The response includes the current robot state, license window/status and sanitized audit history for that robot. Organization users can only open robot detail for their own tenant. The detail response never includes activation license keys, license ciphertext, license fingerprints, JWTs, refresh tokens or credential secrets.

Robot login stores safe login metadata for last-seen/app-version tracking. The robot-authenticated device profile route stores the latest approved Android display/profile values for CMS fleet visibility. JWTs, license keys and credentials are not returned by either API.

Android can update the current approved device and hardware profile after robot login:

```text
PUT http://localhost:3001/api/v1/robot/device-profile
Authorization: Bearer <robot-access-token>
```

Body:

```json
{
  "manufacturer": "Sanbot",
  "deviceModel": "Mini ELF",
  "androidVersion": "7.1.2",
  "apiLevel": 25,
  "appVersionName": "0.1.0",
  "appVersionCode": 2,
  "hardwareProfile": {
    "model": "MINI_ELF",
    "manufacturer": "Sanbot",
    "androidApiLevel": 25,
    "abi": "arm64-v8a",
    "display": {
      "width": 1920,
      "height": 1200
    },
    "capabilities": {
      "camera": true,
      "autonomousNavigation": true,
      "armMotion": true
    }
  }
}
```

The full payload is required. Invalid hardware profile values return `400 Bad Request` before stored profile values are overwritten. Repeating the same valid payload is accepted and keeps the same approved profile values.

Super Admin can rotate a robot credential. The response returns the new activation `licenseKey`; the previous key stops working immediately.

```text
POST http://localhost:3001/api/robots/{id}/credentials/rotate
Authorization: Bearer <super-admin-token>
X-Correlation-Id: <request-id>
```

Super Admin can also revoke the current robot credential. The response does not include `licenseKey`; later robot login attempts return the locked/revoked error.

```text
POST http://localhost:3001/api/robots/{id}/credentials/revoke
Authorization: Bearer <super-admin-token>
X-Correlation-Id: <request-id>
```

Super Admin can reassign a robot to another organization. This preserves the F02 cache-reset contract by incrementing the old and new organization tenant versions. The reassignment response and history APIs do not include license keys or credentials.

```text
PATCH http://localhost:3001/api/robots/{id}/reassign
Authorization: Bearer <super-admin-token>
X-Correlation-Id: <request-id>
```

Body:

```json
{
  "orgId": 2
}
```

Authorized administrators can read sanitized reassignment history:

```text
GET http://localhost:3001/api/robots/{id}/reassignment-history?limit=50
Authorization: Bearer <user-token>
```

History rows contain actor IDs, old organization ID, new organization ID, timestamp and correlation ID only. Raw audit metadata, license keys, tokens and credentials are not returned.

Authorized CMS administrators can erase stored robot device metadata:

```text
DELETE http://localhost:3001/api/robots/{id}/device-metadata
Authorization: Bearer <user-token>
X-Correlation-Id: <request-id>
```


Per-robot capability assignments restrict which organization-effective capabilities a robot actually receives during sync. Authorized admins can assign one active, organization-permitted capability and optional validated parameter limits.

```text
PUT http://localhost:3001/api/robots/{id}/capability-assignments
Authorization: Bearer <user-token>
X-Correlation-Id: cms-49-check
```

Body:

```json
{
  "capabilityStableKey": "audio.speaker",
  "isEnabled": true,
  "limits": {
    "maxVolume": 80,
    "modes": ["classroom"]
  }
}
```

The next robot sync returns only capabilities that are both organization-effective and enabled for that robot. Returned capability rows include the validated `limits` object. Invalid limit keys or secret-like values are rejected before mutation. Assignment writes increment `tenantVersion` and record a sanitized audit event.

```text
GET http://localhost:3001/api/robots/{id}/capability-assignments
Authorization: Bearer <user-token>
```

Assignment APIs do not return license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.

Optional per-user capability assignments further restrict which organization-effective capabilities a user can access. Authorized admins can assign one active, organization-permitted capability and optional validated parameter limits.

```text
PUT http://localhost:3001/api/users/{id}/capability-assignments
Authorization: Bearer <user-token>
X-Correlation-Id: cms-50-check
```

Body:

```json
{
  "capabilityStableKey": "audio.speaker",
  "isEnabled": true,
  "limits": {
    "maxVolume": 60,
    "modes": ["teacher-led"]
  }
}
```

The effective user capability response is the intersection of the active organization entitlement/override set and the enabled assignments on the target user. If the organization subscription expires, an override denies the capability, the user assignment is disabled or the organization is inactive, the capability is not returned.

```text
GET http://localhost:3001/api/users/{id}/effective-capabilities
Authorization: Bearer <user-token>
```

Success response:

```json
{
  "userId": 23,
  "orgId": 7,
  "capabilities": [
    {
      "id": 1,
      "stableKey": "audio.speaker",
      "name": "Speaker Output",
      "category": "audio",
      "version": 1,
      "requiredHardware": {
        "capabilities": ["speaker"]
      },
      "limits": {
        "maxVolume": 60,
        "modes": ["teacher-led"]
      }
    }
  ]
}
```

```text
GET http://localhost:3001/api/users/{id}/capability-assignments
Authorization: Bearer <user-token>
```

Invalid limit keys or secret-like values are rejected before mutation. User capability assignment APIs increment the tenant cache version and record sanitized audit metadata without license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.

## Effective Entitlement Resolver

The F04 effective entitlement resolver is the final decision point for capability access. It consumes the capability catalogue, plan capabilities, organization subscription state, organization capability overrides, robot assignments, optional user assignments and robot hardware capabilities.

Resolver behavior:

- Expired, inactive, missing or not-yet-active subscriptions return no paid capabilities unless an organization override explicitly allows a capability.
- Organization `DENY` overrides remove capabilities and `ALLOW` overrides add active capabilities for that target organization only.
- Robot assignments reduce the organization-effective set to capabilities enabled for the robot.
- Optional user assignments further reduce the set to capabilities enabled for the user when a user context is supplied.
- Hardware requirements are enforced against the robot hardware capability map; unsupported required hardware removes the capability from the effective set.
- Returned capability rows include only safe catalogue metadata and validated `limits`.

Robot sync uses this resolver for `entitlements.paidCapabilities`, so Android receives only the final permitted capability set for that robot and hardware profile. Administrative user capability reads use the same resolver for user intersections. Resolver responses do not include license keys, JWTs, credential ciphertext, fingerprints, passwords or private secret fields.

## Robot Sync

Use this route after robot login. It returns the robot configuration and available content.

```text
GET http://localhost:3001/api/v1/robot/sync
```

Headers:

```text
Authorization: Bearer <robot-access-token>
X-Robot-App-Version: 0.1.0
X-Robot-Device-Model: Mini ELF
```

`X-Robot-App-Version` and `X-Robot-Device-Model` are optional heartbeat headers. When supplied, CMS stores them on the authenticated robot record and updates `lastSeenAt`. The values are never used to identify another robot or organization.

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
Authorization: Bearer <robot-access-token>
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
Authorization: Bearer <robot-access-token>
```

5. Renew the access token:

```text
POST http://localhost:3001/api/v1/robot/auth/refresh
```

6. Upload robot logs:

```text
POST http://localhost:3001/api/v1/robot/logs/batch
Authorization: Bearer <robot-access-token>
Content-Type: application/json
```

7. Repeat the same requests against the legacy routes and confirm they still work.

8. Check the backend terminal for legacy deprecation warnings.

## Android Mock Fixture Trace

Android mock fixtures should map to the OpenAPI examples by operation ID:

| Operation ID | Route | Fixture purpose |
| --- | --- | --- |
| `loginUserV1` | `POST /api/v1/auth/login` | CMS user/admin login success and credential failures |
| `loginRobotV1` | `POST /api/v1/robot/auth/login` | Robot activation login success, invalid license or serial, expired license, revoked license and inactive organisation |
| `refreshRobotTokenV1` | `POST /api/v1/robot/auth/refresh` | Access-token renewal success, invalid or expired refresh token, expired license, revoked license and inactive organisation |
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

Repeated invalid login attempts are throttled:

```json
{
  "statusCode": 429,
  "message": "Too many login attempts. Try again later.",
  "error": "Too Many Requests"
}
```

Failed login audit events store controlled reason codes and hashed identifiers only. Passwords, JWTs, refresh tokens and robot license keys are not stored in audit metadata.

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
