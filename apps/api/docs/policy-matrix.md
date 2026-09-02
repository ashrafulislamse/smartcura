# Authorization and Object-Policy Matrix

**Status:** Stage 0A authorization decision approved
**Version:** 0.3
**Date:** 26 July 2026
**Scope:** FYP environment and extensible full-platform authorization model

This document resolves the initial organization, role, session, permission-grammar and object-access decisions required by `WP-01`. Firebase proves identity only. NestJS and PostgreSQL remain authoritative for memberships, active roles, object relationships, consent, break-glass access and audit.

## 1. Prototype organization and site decision

1. Seed one organization, **SmartCura Demo**, from the first foundation migration.
2. Seed one `virtual_clinic` site for the FYP telemedicine, IoT and AI checkpoint.
3. Add pharmacy and emergency sites when `WP-10` and `WP-12` begin; do not invent their production locations from mock addresses.
4. Every staff membership belongs to an organization. A membership may be organization-wide or restricted to one or more sites.
5. Patient membership is organization-wide but grants only own/dependant resources. It does not expose other organization records.
6. Doctor membership is organization-wide for discovery and may carry site assignments for scheduling/care delivery.
7. Driver membership is organization-wide for eligibility; active dispatch assignment, not membership alone, reveals job data.
8. Pharmacy and emergency memberships require at least one site when those modules are enabled.
9. Admin is organization-scoped. Super-admin is platform-scoped for system administration, but neither role receives clinical-record access merely from administrative rank.
10. Every domain row carries organization ownership directly or through a required parent. Site-owned rows cannot be queried without organization and site predicates.

These rules resolve `CAP-P0-10`. Multi-organization behavior is retained in schema and policy even though the FYP seed has one organization.

## 2. Seeded memberships

| Role ID | Purpose | Default scope | Clinical-data rule |
|---|---|---|---|
| `patient` | Receive care and manage own/dependant data | Own within organization | Own records; dependant records only through active grant |
| `doctor` | Deliver assigned care | Organization plus optional sites | Assigned/participating patients only; emergency access requires break-glass |
| `driver` | Perform pharmacy deliveries | Organization eligibility plus active job | Minimum job data only while offer/assignment policy permits |
| `pharmacy` | Validate and fulfil prescriptions | Required site | Minimum prescription/order data for the site; no general medical record |
| `emergency` | Triage and dispatch emergency response | Required site/operations area | Active emergency data; expanded access only through break-glass |
| `admin` | Operate users, reports, support and configuration | Organization | Administrative metadata, not clinical payloads |
| `super_admin` | Platform configuration and incident administration | Global | No automatic clinical access; object policies still apply |

System roles are seeded and immutable in identity. Custom roles may combine explicit permissions later, but cannot bypass object policies or grant `global` scope.

Membership creation is explicit and never performs automatic active-role selection. An authenticated profile may self-apply only for `patient`, `doctor`, `driver`, `pharmacy`, or `emergency`; `patient` is created `active`, while the professional roles are created `applied`. Self-application for `admin` and `super_admin` is forbidden. Organization admins and platform super-admins with current step-up may create an `invited` membership for an existing profile in role `patient`, `doctor`, `driver`, `pharmacy`, `emergency`, or `admin`; email-token invitation delivery and acceptance are deferred.

Membership state and verification state are orthogonal. Verification approval never activates a membership. Activating an `applied` or `invited` professional membership (`doctor`, `driver`, `pharmacy`, or `emergency`) requires approved verification and the reviewed administrator status command. Duplicate organization/profile/role membership creation returns `409 MEMBERSHIP_ALREADY_EXISTS`.

## 3. App sessions, active role and MFA

A verified Firebase ID token is exchanged/linked to a server `app_session`. During bootstrap, `active_role` may be `null` while profile completion, verification or role selection is required; protected business access requires exactly one active role backed by an active membership. Role switching is a server command that re-evaluates membership, records a `session_event`, preserves the non-secret application-session identifier, rotates the opaque session token and CSRF token, and never trusts a role asserted by the client.

| Role | TOTP MFA in FYP | Idle timeout | Absolute session limit | Step-up examples |
|---|---:|---:|---:|---|
| Patient | Optional | 60 minutes | 12 hours | Export/delete workflow; dependant grant change |
| Doctor | Required | 15 minutes | 12 hours | Sign prescription; break-glass; role switch |
| Driver | Optional | 30 minutes | 12 hours | Change bank details; withdrawal |
| Pharmacy | Required | 15 minutes | 12 hours | Controlled-substance action; reconciliation approval |
| Emergency | Required | 30 minutes | 8 hours | Break-glass; manual dispatch override |
| Admin | Required | 15 minutes | 8 hours | Suspend user; change role; custom role change; payout action |
| Super-admin | Required | 10 minutes | 4 hours | Every role/configuration/security change; maintenance mode change; dead-letter replay |

A Firebase refresh token does not reactivate an idle SmartCura app session. The API updates activity only after an authenticated request passes policy; a connected but idle Socket.IO transport is not activity. Deactivation revokes memberships and app sessions in one transaction and emits an outbox event for downstream disconnect/notification handling.

Step-up means recent Firebase reauthentication plus satisfied MFA, recorded server-side. The default freshness window is five minutes. An active navigation/delivery screen may preserve local route guidance during network loss, but must not reveal newly fetched patient data or perform a state transition until the session is valid again.

These decisions replace the browser-local timers in `sessionManager.ts` and resolve the membership/active-role part of `CAP-P0-02`.

## 4. Permission grammar

Canonical form:

```text
resource[.subresource]:action[:scope]
```

Canonical scopes are `own`, `assigned`, `site`, `organization` and `global`.

- Omitted scope means the action is evaluated against the specific object's relationship policy; it never means unrestricted access. The shared `patient.record:read` seed is deliberately unscoped so the same permission can be narrowed to self, an active dependant grant, an ordinary care assignment or an active break-glass relationship.
- `own` means the authenticated profile is the resource owner/subject; it never silently includes a dependant.
- Dependant access requires both an unscoped resource permission and an active grant naming the dependant, resource class, action and validity window.
- `assigned` means an active, time-valid domain relationship exists, such as care assignment, appointment participation or dispatch assignment.
- `site` and `organization` require both an active membership and matching row ownership.
- `global` is available only to seeded platform permissions and does not override clinical object policy.
- Break-glass is not a reusable scope. It creates a short-lived, audited emergency access grant evaluated as a temporary relationship.
- Action wildcard `*` is allowed only in reviewed seeded system permissions. It cannot be assigned to custom roles and never bypasses an object-policy check.
- A permission held by a client is display/navigation evidence only. The server loads the permission set for every app session from PostgreSQL.

Examples:

```text
profile:read:own
patient.record:read
appointment:cancel:own
conversation.message:create:assigned
pharmacy.order:update:site
emergency.dispatch:assign:site
system.setting:update:organization
system.security:manage:global
```

Dot-separated subresources remove the ambiguity in current strings such as `pharmacy:order:read`. There is no role inheritance in authorization evaluation: shared permissions are expanded into role seeds explicitly. This resolves `CAP-P0-03`.

## 5. Policy evaluation order

Every protected command/query follows this deny-by-default order:

1. Verify the opaque SmartCura session cookie, token hash, expiry and revocation state. Firebase ID tokens are verified only during session bootstrap, refresh and step-up, where they bind the session to the Firebase UID/profile.
2. Load the active SmartCura app session and active membership/role.
3. Match the required canonical permission.
4. Load organization/site ownership and the minimum relationships required by the policy.
5. Evaluate object access: own, dependant, assigned, site, organization or active break-glass grant.
6. Apply consent, status, purpose and minimum-necessary field projection.
7. For sensitive actions, require reason and recent step-up authentication.
8. Execute or deny with a stable Problem Details code and correlation ID.
9. Append the required audit record; sensitive reads are audited as well as writes.

A route-level permission without step 5 is never sufficient for records, files, messages, vitals, prescriptions, locations or AI artifacts.

## 6. Object-policy matrix

Legend: `own` = subject/owner; `dep` = active dependant grant; `asg` = active domain assignment/participation; `site`/`org` = scoped operational access; `min` = minimum-necessary projection; `BG` = active break-glass grant; `—` = deny by default.

| Resource | Patient | Doctor | Driver | Pharmacy | Emergency | Admin | Super-admin | Break-glass |
|---|---|---|---|---|---|---|---|---|
| Profile/contact | own, dep | own; patient min+asg | own; recipient min+asg | own; customer min+site order | own; patient min+active event | org administrative fields | global administrative fields | Patient emergency fields only |
| Allergies, conditions, medical records, labs | own, dep | asg + consent/purpose | — | Prescription minimum only | active event minimum | — | — | Doctor/emergency role, reason, active event |
| Doctor professional profile | Read approved public view | own | Read approved public view | Read approved public view | Read approved public view | org verify/manage | global metadata/manage | Not applicable |
| Appointment/slot | own/participant | own/participant or asg | — | — | Active-event link only | org operational metadata | global metadata | Clinical details only if needed for event |
| Consultation and clinical note | participant own | author/participant + asg | — | — | Active event minimum | — | — | Read needed history; emergency note appended separately |
| Prescription | own | issuer/assigned; signed immutable | — | site order/validation minimum | Active event medication minimum | Status/operational metadata only | Metadata only | Current medication minimum |
| Conversation/message | participant | participant + asg | Dispatch channel participant | Order channel participant | Event channel participant | Support threads only | Security metadata only | No historical chat browsing |
| IoT device, reading and alert | own, dep | assigned patient | — | — | Active-event snapshot/stream | Device operational metadata | Device operational metadata | Time-bounded patient readings |
| AI conversation/artifact/review | own patient view | assigned reviewer/author | — | — | Safety summary only if linked to event | Usage/safety metadata, no prompt payload | Provider/usage metadata | No broad AI history |
| Pharmacy order/inventory | own order view | Prescription origin/status | Assigned delivery minimum | site | Emergency medication request if implemented | org finance/ops metadata | global ops metadata | Not applicable |
| Delivery/job/location/proof | Recipient own view | — | offer summary then active asg | dispatching site | — | org operational metadata | global operational metadata | Not applicable |
| Emergency event/triage/dispatch | own event | assigned or BG | Assigned response minimum only | — | site/active event | Aggregate operational metadata | Security/operational metadata | Primary controlled path |
| Finance/ledger/payout/withdrawal | own payment/refund | own payout | own earning/withdrawal | site settlement | Site operational cost if enabled | org finance permission | global finance/security permission | Never |
| Support ticket | own requester | own requester | own requester | own/site requester | own/site requester | assigned/org support | global support metadata | Never |
| Role, setting, audit, export | own session events only | own security/session events | own security/session events | site settings where delegated | site settings where delegated | org permission; audit purpose | global permission; audit purpose | Break-glass audit is immutable |
| File object | Inherits linked resource | Inherits linked resource | Active proof/job link | Site order/inventory link | Active event link | Metadata only unless linked policy grants content | Metadata only unless linked policy grants content | Time-bound signed access only |

## 7. Consent, dependant and care-assignment precedence

1. The patient always has own access unless a specific workflow is legally restricted; such restrictions require a separate reviewed policy, not an ad hoc flag.
2. A dependant grant names the dependant, grantee, allowed resource classes, actions, start/end time and evidence/status. It is not equivalent to account sharing, does not reinterpret `own`, and cannot grant an action absent from the grantee's server-loaded permission set.
3. A doctor requires an active care assignment or appointment/consultation participation for ordinary clinical access. Organization membership alone is insufficient.
4. Consent may narrow optional sharing and provider access, but cannot silently expand access beyond role permission and assignment.
5. Revoking consent or an assignment blocks future ordinary access; it does not delete immutable notes, prescriptions or audit records already created lawfully.
6. Active emergency break-glass may override ordinary consent for minimum-necessary care. The reason, event, fields accessed and duration are audited and disclosed to the patient after the event where policy permits.
7. When relationships conflict, the effective result is the intersection of role permission, active membership, object relationship, consent and resource status, except for the explicit break-glass overlay.

## 8. Break-glass policy

Break-glass is available only to an active `doctor` or `emergency` membership. It requires:

- an active emergency event, patient and organization match
- a structured reason plus optional free-text detail
- recent step-up authentication unless the configured emergency outage procedure is invoked
- a maximum 15-minute grant, renewable only with a new reason/event record
- field-level minimum-necessary projection
- audit on activation, every sensitive read, renewal and termination
- immediate security/operations notification through the outbox
- retrospective review; the actor cannot review/approve their own use

An active break-glass grant temporarily satisfies only the clinical object-relationship check for the named patient/event; the actor must still hold both `break_glass:activate` and the underlying unscoped clinical permission such as `patient.record:read`. Activation alone is never read authority. Break-glass never permits finance, role administration, unrestricted file browsing, AI history, controlled-substance inventory changes or deletion. Outage-mode access is a separately enabled feature flag and produces the same audit trail once connectivity returns.

## 9. Initial permission seed catalogue

This is the minimum seed vocabulary for contract skeletons. Later work packages add reviewed permissions; they do not rename these silently.

| Role | Initial permissions |
|---|---|
| Patient | `profile:read:own`, `profile:update:own`, `patient.record:read`, `appointment:read:own`, `appointment:create:own`, `appointment:cancel:own`, `consultation:join:own`, `conversation:read:own`, `conversation.message:create:own`, `prescription:read:own`, `iot.device:manage:own`, `iot.reading:read:own`, `ai.artifact:read:own`, `emergency.event:create:own`, `support.ticket:manage:own` |
| Doctor | `profile:read:own`, `profile:update:own`, `patient.record:read`, `appointment:read:assigned`, `appointment:update:assigned`, `availability:manage:own`, `consultation:manage:assigned`, `clinical_note:manage:assigned`, `prescription:create:assigned`, `prescription.sign:assigned`, `conversation.message:create:assigned`, `iot.reading:read:assigned`, `iot.alert:manage:assigned`, `ai.artifact:review:assigned`, `break_glass:activate` |
| Driver | `profile:read:own`, `profile:update:own`, `driver.document:manage:own`, `dispatch.offer:read:assigned`, `dispatch.offer:respond:assigned`, `delivery:update:assigned`, `delivery.proof:create:assigned`, `location.waypoint:create:assigned`, `earning:read:own`, `withdrawal:create:own` |
| Pharmacy | `profile:read:own`, `profile:update:own`, `pharmacy.order:read:site`, `pharmacy.order:update:site`, `prescription_validation:manage:site`, `inventory:read:site`, `inventory.reservation:manage:site`, `stock_ledger:post:site`, `procurement:manage:site`, `return:manage:site`, `reconciliation:manage:site`, `dispatch_job:create:site` |
| Emergency | `profile:read:own`, `profile:update:own`, `patient.record:read`, `emergency.event:read:site`, `emergency.triage:manage:site`, `emergency.dispatch:manage:site`, `emergency.communication:manage:site`, `emergency.fleet:read:site`, `emergency.resolution:create:site`, `break_glass:activate` |
| Admin | `profile:read:own`, `profile:update:own`, `membership:manage:organization`, `membership:invite:organization`, `doctor_verification:manage:organization`, `appointment:read:organization`, `support.ticket:manage:organization`, `content:manage:organization`, `finance:read:organization`, `audit:read:organization`, `export:create:organization`, `system.setting:manage:organization` |
| Super-admin | `profile:read:own`, `profile:update:own`, `system.security:*:global`, `system.setting:*:global`, `organization:*:global`, `membership:*:global`, `role:*:global`, `audit:read:global`, `export:create:global`; no implicit clinical-content permission |

`manage` is used only where the resource state machine will define its allowed action set. Security-sensitive domains should expand it into explicit actions before endpoint implementation. Permission aliases and migrations are required if a published contract later renames a permission.

## 10. Stable authorization outcomes

| HTTP status | Stable code | Use |
|---:|---|---|
| 401 | `AUTH_TOKEN_INVALID` | Firebase token missing, invalid or expired |
| 401 | `APP_SESSION_INVALID` | No active SmartCura session or session expired/revoked |
| 403 | `MEMBERSHIP_INACTIVE` | Requested active role has no active membership |
| 403 | `PERMISSION_DENIED` | Role lacks the required permission |
| 403 | `OBJECT_ACCESS_DENIED` | Permission exists but own/assigned/site/org policy fails |
| 403 | `CONSENT_REQUIRED` | Required patient consent/grant is absent or expired |
| 403 | `STEP_UP_REQUIRED` | Sensitive command requires fresh reauthentication/MFA |
| 403 | `BREAK_GLASS_REQUIRED` | Emergency-only clinical access has not been activated |
| 404 | `RESOURCE_NOT_FOUND` | Resource is absent, or existence must be concealed from this actor |
| 409 | `MEMBERSHIP_ALREADY_EXISTS` | The profile already has the requested role membership in the organization |
| 409 | `ROLE_SWITCH_CONFLICT` | Target role is inactive/incompatible with current workflow |

Error details never reveal another patient's existence or protected field values.

### 10.1 Reviewed allow/deny examples

These examples are normative Stage 0A policy decisions. Every deny records actor, active membership, required permission, object identifier/type, evaluated relationship, stable reason and correlation ID without protected values. Sensitive-resource reads may return concealed `404 RESOURCE_NOT_FOUND` instead of a revealing 403.

| Layer/relationship | Required permission | Allow example | Paired deny and stable outcome |
|---|---|---|---|
| Session | `profile:read:own` | Active, unexpired and unrevoked app session continues evaluation. | Missing, expired or revoked app session → `401 APP_SESSION_INVALID`. |
| Membership | `profile:read:own` | Selected patient membership is active. | Selected membership suspended/revoked/expired → `403 MEMBERSHIP_INACTIVE`. |
| Permission | `finance:read:organization` | Admin holds permission and row organization matches; return minimum finance projection. | Patient lacks permission → `403 PERMISSION_DENIED`. |
| Own | `profile:read:own` | Authenticated profile ID equals the requested profile ID. | Same permission against another profile → `403 OBJECT_ACCESS_DENIED` or concealed `404 RESOURCE_NOT_FOUND`. |
| Dependant | `patient.record:read` | Active grant names grantee/dependant, includes the resource class/action and is within its validity window. | Grant absent, expired or action excluded → `403 CONSENT_REQUIRED`; `own` is never reinterpreted. |
| Assigned care | `patient.record:read` | Doctor has active time-valid care/appointment participation, required consent and a clinical purpose; sensitive read is audited. | No relationship → `403 OBJECT_ACCESS_DENIED`; required consent absent → `403 CONSENT_REQUIRED`. |
| Assignment status | `delivery:update:assigned` | Driver owns the current active dispatch assignment and requests a valid transition. | Offer-only, expired or reassigned job → `403 OBJECT_ACCESS_DENIED`; a valid actor requesting an invalid domain transition receives the slice's reviewed 409 code. |
| Site | `pharmacy.order:read:site` | Active pharmacy membership contains the order's organization/site. | Same organization but unassigned site → `403 OBJECT_ACCESS_DENIED` or concealed 404. |
| Organization | `appointment:read:organization` | Admin membership and appointment organization match; clinical detail remains excluded. | Cross-organization appointment → `403 OBJECT_ACCESS_DENIED` or concealed 404. |
| Global | `audit:read:global` | Super-admin declares an audit purpose and receives the permitted audit projection; access is audited. | Attempt to read clinical content using only global administration permissions → `403 PERMISSION_DENIED`; global does not override clinical policy. |
| Step-up | `prescription.sign:assigned` | Assigned doctor, valid prescription state, required TOTP and reauthentication not older than five minutes. | Same facts with stale/missing step-up → `403 STEP_UP_REQUIRED`. |
| Break-glass | `break_glass:activate` + `patient.record:read` | Doctor/emergency role, matching active event, structured reason, fresh step-up and unexpired grant of at most 15 minutes; return minimum fields and audit every read. | Missing/expired grant → `403 BREAK_GLASS_REQUIRED`; finance, role administration, broad files and AI history remain denied. |

A later work package may add a more specific permission or domain conflict code, but it cannot weaken these deny layers. Each vertical slice converts applicable rows into executable allow/deny and non-disclosure tests before its endpoint is accepted.

## 11. Client migration consequences

- Delete portal hardcoded credentials, fake tokens and `localStorage` token/permission authority during `WP-03`.
- Portal RBAC helpers may remain only for navigation and disabled-state UX using server-provided effective permissions.
- Replace browser-local audit/session authority with server app sessions and append-only audit records.
- Add patient and driver to generated role types; do not extend the current hand-written `RoleId` as the contract source.
- Mobile apps use Firebase SDK for identity lifecycle and secure platform storage, but all active-role and business authorization comes from NestJS.
- No production client may interpret a route guard as proof that an object command is authorized.

OpenAPI security/error components, permission seeds and the reviewed allow/deny examples now encode the Stage 0A authorization decisions. Each implemented vertical slice must turn the applicable examples into executable authorization and non-disclosure tests. Legal review may tighten retention or consent wording, but it must not weaken deny-by-default or server authority.
