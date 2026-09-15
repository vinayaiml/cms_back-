# WhizSingular Release 1 Integration Testing Release Plan

## 1. Purpose

This document adds a common Definition of Done and integration process across all WhizSingular Release 1 tickets.

It does not:

- Change the 12-feature scope
- Rewrite approved tickets
- Replace ticket-specific acceptance criteria
- Reopen completed tickets
- Authorize production deployment

Completed tickets are covered through the Release 1 regression cycle.

## 2. Document Control

| Field | Value |
| --- | --- |
| Context version | 1.0.0 |
| Release | Release 1 |
| Last updated date | 2026-08-31 |
| Document owner | Sachin |
| Android repository | WhizSingular Android repository |
| CMS repository | WhizRobot CMS repository |
| OpenAPI path | `docs/api/openapi.yaml` |
| OpenAPI version | 1.0.0 |
| OpenAPI SHA-256 | `F53EDB5948263880D45B253E4BE8BAFDD07BD2326D91ECBEFC072878A9101BEF` |
| Integration environment | Pending team-owned deployment |
| Staging environment | Pending release-candidate deployment |
| Production environment | Not authorized by this document |

Do not place passwords, database credentials, API tokens or private keys in this file.

## 3. Team Ownership

- Vinay: CMS backend, API, security and deployment
- Abhay: CMS frontend
- Akshay: Android architecture, SDK, API, offline handling and integration
- Baibhab: Android UI, navigation and screen states
- Tester: independent verification and evidence
- Sachin: coordination, prioritisation and release review

No developer should self-approve their complete integration flow.

## 4. Environment Matrix

| Environment | Android mode | CMS/API | Database | Data |
| --- | --- | --- | --- | --- |
| Local | Mock | Not required | None/local | Synthetic fixtures |
| Integration | Live | Deployed test CMS | Separate integration DB | Seeded test data |
| Robot QA | Live | Integration CMS | Integration DB | Approved robot identities |
| Staging | Live | Release-candidate CMS | Separate staging DB | Anonymised test data |
| Production | Live | Production CMS | Production DB | Controlled customer data |

Secrets, URLs and databases must remain separate across environments.

## 5. Common Per-Ticket Workflow

Every remaining feature ticket must follow:

1. Read shared context and OpenAPI.
2. Identify the paired Android/CMS contract.
3. Implement using mock data where the live dependency is unavailable.
4. Run repository-level automated tests.
5. Verify OpenAPI and fixture compatibility.
6. Merge the approved CMS change.
7. Deploy CMS to the integration environment.
8. Build Android integration APK in LIVE mode.
9. Run Android-CMS end-to-end testing.
10. Test on an approved robot where hardware is involved.
11. Correct defects.
12. Run regression tests.
13. Save sanitised evidence.
14. Obtain independent approval.
15. Mark the ticket complete.

Do not delay steps 6-14 until all 12 features are finished.

## 6. Common Definition of Done

A feature is complete only when applicable checks pass:

- Code compiles.
- Automated tests pass.
- OpenAPI contract is current.
- Mock fixtures remain traceable to OpenAPI.
- CMS deployment succeeds.
- Android integration build connects to the live integration CMS.
- Success path passes.
- Defined error paths pass.
- Offline and reconnection behaviour pass.
- No duplicate data is created after retry.
- Robot hardware behaviour passes where applicable.
- No secret or personal data appears in logs.
- Evidence is recorded.
- No blocker or critical defect remains.
- Another team member verifies the result.

A ticket can be code-complete before live integration, but it must be labelled accordingly and must not be treated as release-ready.

## 7. Integration Test Evidence

Save only sanitised evidence under:

```text
docs/test-evidence/release-1/<ticket-id>/
```

Evidence may contain:

- Test summary
- Environment
- APK version
- CMS deployment version
- Git commit identifiers
- OpenAPI version
- Robot model and Android API level
- PASS/FAIL results
- Sanitised screenshots
- Sanitised logs
- Defect links
- Tester name and date

Never commit:

- Real tokens
- Passwords
- Database connection strings
- Private URLs containing credentials
- Customer or visitor personal data
- Raw production logs
- APKs or build outputs

## 8. Contract-Change Control

OpenAPI is the API source of truth.

Any contract change must include:

1. Reason for change.
2. OpenAPI update.
3. Version or change note.
4. Updated examples.
5. Updated CMS tests.
6. Updated Android fixtures/tests.
7. Approval from both Android and CMS technical owners.

Do not silently derive a new contract independently in either repository.

## 9. Robot Test Matrix

Preserve support for:

| Robot | Android/API | ABI | Display |
| --- | --- | --- | --- |
| Mini ELF | Android 7.1.2 / API 25 | `arm64-v8a` | 1920x1200 |
| ELF | Android 6.0.1 / API 23 | `armeabi-v7a` | 1920x1200 |
| Nano | Android 6.0.1 / API 23 | `armeabi-v7a` | 1920x1200 |
| S5 | Android 12 / API 31 | `arm64-v8a` | 1920x1080 |

Capability detection must not depend only on the reported device model because ELF and Nano report similar platform details.

## 10. Defect Handling

Classify integration defects:

- Blocker: release or core flow cannot operate
- Critical: security, data-loss, authentication or organisation-isolation failure
- Major: primary feature fails without a safe workaround
- Minor: limited functional or visual issue

Blocker and critical defects must be resolved before staging approval.

A defect must reference:

- Android commit
- CMS commit
- Environment
- OpenAPI version
- Reproduction steps
- Expected result
- Actual result
- Robot/device
- Sanitised evidence

## 11. Release Gates

Release 1 requires:

- Android CI passing
- CMS backend CI passing
- CMS frontend CI passing
- OpenAPI and Android fixtures aligned
- All 12 features tested
- Authentication and tenant isolation verified
- Offline cache and duplicate-free resynchronisation verified
- API 23, API 25 and API 31 coverage
- No blocker or critical defects
- Complete end-to-end acceptance
- Eight-hour controlled soak test
- Tester approval
- Android technical approval
- CMS technical approval
- Release-owner approval
- Documented rollback procedure

## 12. CMS Repository Readiness

Detected repository role: CMS.

Current CMS baseline:

- `/api/v1` routing is implemented for authentication and robot baseline routes.
- OpenAPI contract exists at `docs/api/openapi.yaml`.
- API usage guide exists at `docs/api/api.md`.
- PostgreSQL local development uses Docker Compose.
- Environment-variable validation is implemented for JWT, database, Redis-enabled startup and CORS allow-list configuration.
- Organization password storage has been removed from the application model.
- Inactive organization robot access returns the domain locked error.

CMS items that still require environment or team approval:

- Health/readiness endpoint verification or implementation.
- CMS backend CI configuration.
- CMS frontend CI configuration.
- Integration deployment target selection.
- Separate integration database provisioning.
- Repeatable integration seed reset procedure for deployed integration.
- Deployment rollback procedure for the selected host.
- Secure handoff method for test credentials.

The integration database must be resettable without touching staging or production.

## 13. Integration Handoff To Android

Provide the Android developer with:

```text
Integration API base URL
Deployment identifier
OpenAPI version and hash
Available test operations
Seeded test-account identifiers
Secure method for receiving test credentials
Known limitations
```

Do not place credentials in Git, Jira comments or this shared context file.

## 14. First Live Integration Cycle

Do not wait for the remaining tickets.

Start the first integration cycle when the CMS has:

- A working integration deployment
- Database migrations
- Seeded test organisation and robot
- Authentication endpoint
- Robot sync endpoint
- Robot log upload endpoint
- Current OpenAPI contract

Test this vertical slice:

```text
Robot login
-> secure token storage
-> restart application
-> robot synchronisation
-> robot log upload
-> CMS status confirmation
-> network interruption
-> reconnection
-> retry without duplicate data
```

Record every result in the Release 1 evidence folder.

Continue feature development after the first vertical slice is stable. Repeat integration after every paired Android/CMS feature.

## 15. Recommended Jira Coordination Tasks

Recommended coordination task 1:

```text
CMS Integration Environment Deployment
```

Description:

```text
Create and verify the CMS integration environment for Release 1 Android-CMS live testing.
```

Dependencies:

```text
Current CMS OpenAPI contract, integration database approval, deployment target approval, secure credential handoff process.
```

Acceptance criteria:

```text
Integration CMS is deployed, separate integration database is configured, seeded test organisation and robot are available, /api/v1 auth/sync/log routes work, CORS is configured for approved clients, rollback steps are documented, and non-secret deployment details are shared with Android.
```

Recommended coordination task 2:

```text
Android-CMS Release 1 Integration and Validation
```

Description:

```text
Run the Release 1 Android-CMS live integration cycle, robot QA, regression and evidence collection.
```

Dependencies:

```text
Working CMS integration deployment, current OpenAPI contract, Android integration build configuration, seeded test identities, approved robot access.
```

Acceptance criteria:

```text
Android integration APK connects to the live CMS integration environment, robot login/sync/log upload pass, defined error states pass, offline retry is duplicate-free, API 23/API 25/API 31 coverage is recorded, sanitised evidence is saved, and independent approval is obtained.
```

Do not invent Jira IDs if Jira access is unavailable.

## 16. Safety And Scope Restrictions

- Do not deploy to production.
- Do not use production data.
- Do not expose secrets.
- Do not weaken security checks.
- Do not modify approved feature scope.
- Do not rename existing ticket IDs.
- Do not add undocumented API behaviour.
- Do not create a second conflicting OpenAPI contract.
- Do not commit APKs, build outputs or sensitive logs.
- Do not commit, push, create a PR or deploy external infrastructure unless explicitly authorised.
- Preserve unrelated work in the repository.
