# Canonical Enum and State Catalogue

**Status:** Stage 0A design decisions encoded in foundation contracts
**Version:** 0.2
**Date:** 26 July 2026
**Scope:** Canonical wire vocabulary and state transitions for the full SmartCura platform

This catalogue resolves the client-shape conflicts recorded as `CAP-P0-01` and `CAP-P0-04` through `CAP-P0-09` in `screen-capability-matrix.md`. It is the vocabulary input for OpenAPI, AsyncAPI, migrations and generated Dart/TypeScript models. Existing UI strings remain mapping evidence only.

Authoritative inputs are `screen-capability-matrix.md`, `policy-matrix.md` and the generated OpenAPI/AsyncAPI contracts.

## 1. Wire and persistence conventions

- Enum values use lowercase `snake_case`; labels, colours and localized text are client concerns.
- Published enum values are never silently renamed or reused with a new meaning. Compatibility aliases belong at adapters, not in canonical storage.
- UUIDv7 is used for canonical identifiers. Human references such as `APT-2026-000123` are separate immutable `reference` fields and are never primary/foreign keys.
- IDs, timestamps and transaction references are server-generated. Clients may generate only idempotency keys and offline message/device correlation IDs defined by contract.
- Timestamps are RFC 3339 UTC on the wire and PostgreSQL `timestamptz` in storage. Availability additionally records an IANA timezone such as `Asia/Kuala_Lumpur`.
- Date-only clinical/user values use ISO `YYYY-MM-DD`; durations use integer seconds/minutes or explicit start/end timestamps, never localized strings.
- Money uses signed 64-bit integer sen plus `currency: "MYR"`. Prices and charges are non-negative; ledger postings may be signed. Floating-point ringgit is forbidden in contracts and persistence.
- Measurements carry a canonical metric, numeric primary value, optional secondary value, explicit UCUM unit, source, quality, `recorded_at` and `received_at`.
- State changes append an event containing previous state, next state, actor, reason code, optional safe detail, correlation ID and timestamp.
- Commands that create or transition an aggregate require an idempotency key where a network retry could duplicate work.
- Unknown future enum values must not crash clients. Generated clients expose an unknown fallback for display, but the server never persists the fallback as a domain value.

## 2. Identity bootstrap and account state

### 2.1 Client bootstrap view state

| Value | Meaning |
|---|---|
| `unauthenticated` | No valid Firebase identity; show sign-in/onboarding entry. |
| `authenticating` | Firebase exchange or SmartCura session creation is in progress. |
| `profile_required` | Identity exists but the required SmartCura profile/onboarding data is incomplete. |
| `verification_pending` | Role requires verification before normal access. |
| `role_selection_required` | More than one active membership is available and no active role is selected. |
| `ready` | Valid app session, active membership and completed required onboarding. |
| `offline_demo` | Explicit non-production demo adapter; never selected by authentication failure fallback. |

The patient app must bootstrap through these states instead of setting `/home` as an unconditional initial route. Network or provider failure produces a retryable error, not `offline_demo`. This resolves `CAP-P0-01`.

### 2.2 Server account and verification state

| Enum | Values |
|---|---|
| `profile_status` | `pending`, `active`, `suspended`, `deactivated` |
| `membership_status` | `applied`, `invited`, `active`, `suspended`, `revoked`, `expired` |
| `verification_status` | `not_submitted`, `pending_review`, `changes_requested`, `approved`, `rejected`, `suspended`, `expired` |
| `app_session_status` | `active`, `idle_expired`, `absolute_expired`, `revoked`, `membership_ended` |

A profile may create its own organization membership through `POST /organizations/{organization_id}/memberships/self`. A `patient` request creates `active`; a `doctor`, `driver`, `pharmacy`, or `emergency` request creates `applied`. Self-application for `admin` and `super_admin` is forbidden. An organization admin or platform super-admin with current step-up may use `POST /organizations/{organization_id}/memberships/invitations` to create an `invited` membership for an existing profile in role `patient`, `doctor`, `driver`, `pharmacy`, `emergency`, or `admin`. Email-token invitation delivery and acceptance are deferred.

Creating an `active`, `applied`, or `invited` membership never selects it as the session's active role automatically. `applied` and `invited` memberships may be activated only by the reviewed administrator status command. Verification is orthogonal to membership state: verification approval never activates a membership, and activation of a professional `doctor`, `driver`, `pharmacy`, or `emergency` membership requires `verification_status=approved`.

Suspension is reversible and retains history. Deactivation/revocation is an audited workflow, not row deletion. A duplicate organization/profile/role membership is rejected with `409 MEMBERSHIP_ALREADY_EXISTS`; retries using the same idempotency key return the original result according to the idempotency contract.

`profiles.id` is UUIDv7. `profiles.firebase_uid` is a unique, immutable external-identity key; it is never exposed as `profile_id`. Event `actor_profile_id`, ownership foreign keys and business URLs always use the UUIDv7 profile ID.

### 2.3 Authentication and app-session security contract

1. Firebase SDK handles registration, sign-in, verification, recovery and MFA.
2. `POST /api/v1/sessions` accepts a Firebase ID token through the `firebaseBearer` HTTP bearer scheme. NestJS verifies it with Firebase Admin, maps the unique Firebase UID to a profile and creates the app session.
3. The server creates a UUIDv7 non-secret `session_id` plus a separate opaque 256-bit session token, stores only the token hash and sets `__Host-smartcura_session` as `Secure`, `HttpOnly`, `SameSite=Strict`, path `/`, with no `Domain` attribute.
4. Protected REST routes and the Socket.IO handshake accept only the `smartCuraSessionCookie` scheme. They do not accept a Firebase ID token as business authorization.
5. Flutter clients persist the cookie in an OS-backed secure cookie store; browsers rely on the HttpOnly cookie and never copy it into JavaScript/localStorage.
6. Browser state-changing requests additionally require an origin check and synchronizer `X-CSRF-Token`; Flutter receives the same token from session bootstrap and sends it explicitly.
7. Session refresh and step-up reverify a fresh Firebase ID token, rotate the opaque session token and preserve/rotate the server session record according to audit policy.

OpenAPI therefore uses `firebaseBearer` alone for session bootstrap, both `firebaseBearer` and `smartCuraSessionCookie` for refresh/step-up, and `smartCuraSessionCookie` alone for protected business operations. Each operation has one explicit security requirement.

### 2.4 WP-03 profile/auth implementation alignment

`GET /api/v1/profiles/me` and `PATCH /api/v1/profiles/me` are implemented. The patch accepts only the contract's own-profile fields; explicit `complete_onboarding: true` transitions a `pending` profile to `active` and records server-generated `onboarding_completed_at`. Profile activation completes only the base profile: it creates, activates and selects no membership, grants no role or permission authority, and therefore cannot make bootstrap `ready` by itself.

An authenticated pending profile, or an authenticated profile with no active membership, may use only these self-profile operations as a narrow onboarding-continuity exception. It does not weaken the normal rule that protected business access requires an eligible active membership and server-loaded permission. Reusable guards now enforce opaque-session authentication by default, origin plus synchronizer-CSRF validation for marked state changes, and default-deny permission/membership evaluation; each route must opt into any exception explicitly.

A changed profile is locked and updated in one transaction with its append-only audit record and a single canonical `profile.changed.v1` outbox event. Expired step-up is now rejected by active-role selection, and bootstrap eligibility now excludes inactive/unapproved memberships and returns `verification_pending` rather than `ready` when a selected TOTP-required role lacks a still-current step-up window.

Real PostgreSQL migration, transaction and deny-path evidence has now been collected against PostgreSQL 18.4, and Firebase ID tokens are verified against Google's published signing keys rather than through the Admin SDK. Portal and Flutter client integration evidence remains absent, so `WP-03` remains `in_progress` and the `identity-ready` label has not been earned.

## 3. Availability, appointments and payment

### 3.1 Appointment mode and hold state

| Enum | Values/transitions |
|---|---|
| `appointment_mode` | `video`, `audio`, `chat`, `in_person` |
| `slot_hold_status` | `active` → `consumed`, `released`, or `expired` |

Acquiring a slot creates only a `slot_hold`; it never creates an appointment. Booking validates and consumes the active hold while creating the appointment. `in-person`, `In-Person` and `Video Call` are UI aliases for canonical values. Availability is represented by recurrence rules plus exceptions in the doctor's/site's IANA timezone; generated slots store UTC boundaries. `upcoming` is a read-model category derived from time and active state, not a persisted appointment state.

### 3.2 Appointment state machine

| State | Allowed next states | Rule |
|---|---|---|
| `pending_payment` | `confirmed`, `cancelled` | A positive-value payment intent exists; the consumed hold's slot remains reserved. |
| `confirmed` | `checked_in`, `in_progress`, `completed`, `cancelled`, `no_show` | Zero-cost bookings begin here. Direct `in_progress` supports remote modes; direct `completed` is an audited administrative correction only. |
| `checked_in` | `in_progress`, `cancelled`, `no_show` | Patient check-in is recorded. |
| `in_progress` | `completed`, `cancelled` | Cancellation requires a reason and preserves consultation/audit history. |
| `completed` | — | Terminal. Corrections affect notes/prescriptions, not appointment state. |
| `cancelled` | — | Terminal; slot release/refund behavior follows captured amount and cancellation policy. |
| `no_show` | — | Terminal; actor and attendance evidence are recorded. |

Canonical cancellation reasons initially are `patient_request`, `doctor_request`, `payment_failed`, `payment_timeout`, `rescheduled`, `provider_unavailable`, `system_conflict` and `admin_action`. Hold expiry affects only `slot_hold_status`; no appointment exists to cancel.

Rescheduling creates a replacement appointment in one transaction, links `replaces_appointment_id`/`replaced_by_appointment_id`, and cancels the old appointment with reason `rescheduled`. There is no persisted `rescheduled` state. Patient `upcoming` maps to an active time-based projection; portal `scheduled` maps to `confirmed` only after payment/hold rules pass.

### 3.3 Booking response, payment and refund state

The booking transaction validates and consumes the hold and atomically writes the appointment, required outbox event and—only for a positive amount—the payment intent. A zero-cost appointment has no payment intent and returns `confirmed`. A paid appointment returns `pending_payment`; the slot remains reserved until an idempotent provider-event transaction moves it to `confirmed` or `cancelled`. External payment calls never occur inside the booking transaction. Socket.IO/polling exposes the resulting appointment transition.

| Aggregate/state | Allowed next states | Retry rule |
|---|---|---|
| Payment intent `requires_action` | `processing`, `failed`, `cancelled` | The client may complete the required mock/provider action once per idempotency key. |
| Payment intent `processing` | `succeeded`, `failed` | Provider events deduplicate by provider event ID. |
| Payment intent `succeeded` | — | Terminal; confirms the linked pending appointment idempotently. |
| Payment intent `failed` | — | Terminal; a user retry creates a linked replacement intent/attempt. |
| Payment intent `cancelled` | — | Terminal; allowed only before processing. |
| Payment attempt `started` | `succeeded`, `failed` | A replacement attempt has a new ID; provider correlation is unique. |
| Refund `requested` | `processing`, `cancelled` | Cancellation is allowed only before processing. |
| Refund `processing` | `succeeded`, `failed` | Provider events deduplicate by provider event ID. |
| Refund `succeeded` | — | Terminal; immutable reversal ledger postings exist. |
| Refund `failed` | — | Terminal; retry creates a linked replacement refund request. |
| Refund `cancelled` | — | Terminal. |

Appointment cancellation creates a refund request atomically only when the appointment has a captured/settled positive amount and the cancellation policy calculates a refundable amount greater than zero. Unpaid, failed-payment and zero-cost appointments produce no refund aggregate; the cancellation event records that determination.

`paid`, `pending` and `refunded` are projections from payment/refund aggregates, not appointment status values. The mock provider emits provider-shaped events but never stores card data. A retry returns the original payment/booking result for the same actor, operation and idempotency key.

## 4. Consultation, notes and prescriptions

### 4.1 Consultation state

| State | Allowed next states |
|---|---|
| `not_started` | `ready`, `in_progress`, `cancelled` |
| `ready` | `in_progress`, `cancelled` |
| `in_progress` | `completed`, `cancelled` |
| `completed` | — |
| `cancelled` | — |

A consultation belongs to one appointment. LiveKit room/participant presence is ephemeral delivery state and does not replace consultation state. Only server-authorized participants receive short-lived room tokens.

### 4.2 Clinical note state

| State | Allowed next states | Mutability |
|---|---|---|
| `draft` | `signed`, `discarded` | Author may edit under assignment policy. |
| `signed` | `superseded` | Immutable. |
| `superseded` | — | Immutable; linked replacement version is current. |
| `discarded` | — | Terminal draft outcome; retained per audit policy where required. |

Amending a signed note creates and signs a new version, then marks the old version `superseded`. It never updates signed content in place.

### 4.3 Prescription state

| State | Allowed next states | Rule |
|---|---|---|
| `draft` | `signed`, `discarded` | Issuing doctor may edit. |
| `signed` | `superseded`, `cancelled`, `expired` | Content and items are immutable. |
| `superseded` | — | Replacement prescription is linked. |
| `cancelled` | — | Revocation reason and actor are required. |
| `expired` | — | Terminal time-based state. |
| `discarded` | — | Terminal unsigned draft. |

Correction or renewal creates a new prescription; it does not mutate the signed record. Portal labels `sent` and `renewed` become delivery/version events. `not_required` is a consultation outcome, not a prescription state. Dispensing belongs to pharmacy fulfilment, not this state machine. This resolves `CAP-P0-05`.

Prescription items use structured medication reference/free-text fallback, dose value and unit, route, frequency code/text, duration and patient instructions. Display strings such as `10mg` or `1x Daily` are mapped at client boundaries rather than treated as validated dosage structure.

## 5. Messaging, notifications and files

| Enum | Values |
|---|---|
| `conversation_status` | `active`, `closed` |
| `message_type` | `text`, `file`, `system` |
| `notification_status` | `queued`, `processing`, `delivered`, `failed`, `suppressed` |
| `notification_channel` | `in_app`, `push` |
| `notification_category` | `account_security`, `appointments`, `consultations`, `messages`, `prescriptions`, `vitals_alerts`, `ai_review`, `delivery`, `dispatch`, `emergency`, `system` |
| `upload_intent_status` | `pending_upload`, `uploaded`, `expired`, `cancelled` |
| `file_scan_status` | `pending`, `quarantined`, `clean`, `rejected`, `failed` |

Messages receive a server `sequence_no` unique within a conversation and are read by opaque cursor encoding `(sequence_no, id)`. `created_at` is server time; a client correlation ID deduplicates offline/retried sends. Sender identity comes from the app session, never `isMe` or a request body sender ID.

Notifications are ordered newest-first by opaque cursor encoding `(created_at, id)`; both values are server-generated and the ID is the deterministic tie-breaker. In-app `read_at` is independent from provider delivery status. Pagination responses return `next_cursor` and never accept localized time strings as cursors.

Notification preferences are keyed by profile, category and channel. `in_app` records are authoritative and cannot be disabled; a disabled `push` preference creates a `suppressed` delivery without suppressing the domain event or in-app record. Account-security, active-emergency and critical assigned-care alert pushes are mandatory, minimum-necessary and bypass optional quiet hours. Other push categories default enabled and may be disabled. Quiet hours use the profile IANA timezone; their start/end are local wall-clock values, and delivery resumes after the window without changing event occurrence time. Preferences affect future delivery attempts only and never delete notification or audit history.

Delivery and read state are persistent per-participant receipt timestamps. `isRead` and unread counts are projections. Participant archive/mute settings are per-user and do not close the conversation. Typing and presence are ephemeral Socket.IO events with expiry and are never audit/history records.

A file cannot be linked to a domain aggregate until upload finalization, checksum/type/size validation and `file_scan_status=clean`. Signed URLs inherit the linked object's policy and expire quickly. Object keys contain opaque IDs only.

## 6. IoT devices, readings and alerts

### 6.1 Device and operation state

| Enum | Values |
|---|---|
| `device_lifecycle_status` | `provisioning`, `active`, `suspended`, `retired` |
| `device_connectivity_status` | `unknown`, `online`, `offline` |
| `calibration_status` | `not_required`, `required`, `in_progress`, `passed`, `failed`, `expired` |
| `device_command_status` | `queued`, `dispatched`, `acknowledged`, `failed`, `expired`, `cancelled` |
| `firmware_rollout_status` | `draft`, `scheduled`, `active`, `paused`, `completed`, `failed`, `cancelled` |

Connectivity is derived from authenticated broker activity and heartbeat timing; it is not the lifecycle state. Device assignment is time-bounded with `assigned_at` and `ended_at`, not a mutable patient ID or free-text connection flag.

The FYP hardware profile is `smartcura_esp32_v1`: ESP32 + MAX30102, LM35, and optional AD8232. Commercial names in patient mocks are presentation samples, not accepted provisioned device types.

### 6.2 Vital metric and unit vocabulary

| Metric | Primary value | Secondary value | UCUM unit | Delivery tier |
|---|---|---|---|---|
| `heart_rate` | Beats per minute | — | `/min` | FYP MAX30102 |
| `oxygen_saturation` | Saturation | — | `%` | FYP MAX30102 |
| `body_temperature` | Temperature | — | `Cel` | FYP LM35 |
| `ecg_voltage` | Voltage/sample or aggregate value | Optional channel/secondary value by contract | `mV` | Optional FYP AD8232 |
| `blood_pressure` | Systolic | Diastolic | `mm[Hg]` | Manual/future external device |
| `blood_glucose` | Glucose concentration | — | `mg/dL` | Manual/future external device |
| `body_weight` | Mass | — | `kg` | Manual/future external device |

| Enum | Values |
|---|---|
| `reading_source` | `device`, `manual`, `imported`, `derived` |
| `reading_quality` | `valid`, `suspect`, `invalid`, `unknown` |

Each reading stores metric, primary/secondary values, unit, quality, source, `recorded_at`, `received_at`, device assignment resolution and optional calibration reference. Device packets include `device_id` from broker identity, `boot_id`, monotonically increasing `sequence_no` per boot and metric/sample identity. The server deduplicates on device/boot/sequence/metric; payload patient IDs are ignored.

Only validated `valid` readings drive clinical threshold alerts. `suspect` may produce a data-quality event; `invalid` is retained only according to ingestion/diagnostic policy and never appears as trusted clinical truth.

### 6.3 Health alert state

| State | Allowed next states |
|---|---|
| `open` | `acknowledged`, `escalated`, `resolved`, `dismissed` |
| `acknowledged` | `escalated`, `resolved`, `dismissed` |
| `escalated` | `acknowledged`, `resolved` |
| `resolved` | — |
| `dismissed` | — |

Alert severity is `info`, `warning`, `critical`. Threshold ownership is patient-specific where configured, otherwise organization default. A device-originated alert is an input signal; the server derives the authoritative alert after validation. This resolves `CAP-P0-07`.

## 7. AI clinical-support vocabulary

The canonical aggregate is a **clinical-support artifact**, never an autonomous diagnosis. Patient-facing output is labelled informational/non-diagnostic and cannot change diagnosis, medication, appointment, alert or emergency state.

| Enum | Values |
|---|---|
| `ai_conversation_status` | `active`, `completed`, `cancelled` |
| `ai_generation_status` | `queued`, `running`, `succeeded`, `failed`, `blocked` |
| `ai_artifact_type` | `symptom_summary`, `care_navigation`, `health_summary`, `risk_flag`, `forecast`, `anomaly` |
| `ai_review_status` | `pending_review`, `approved`, `rejected`, `superseded` |
| `ai_risk_level` | `unknown`, `low`, `moderate`, `high`, `critical` |
| `ai_safety_severity` | `info`, `warning`, `critical` |

A successful generation creates a new immutable artifact version in `pending_review`. A permitted doctor may move it to `approved` or `rejected`; a rerun creates another version and an approved replacement may move the old artifact to `superseded`. Review is an immutable event with actor, decision, rationale and timestamp.

Every artifact records provider, model name/version, prompt-template version, retrieval source IDs/chunk IDs, input data classes/time window, generation parameters, usage and safety events. Confidence is nullable and may be shown only when the producing model defines and validates that score; arbitrary LLM certainty percentages are forbidden.

Prohibited automated actions include diagnosing a condition, prescribing/changing medication, opening/closing an emergency, changing a clinical alert, booking/cancelling care, or writing a signed clinical note. The current patient `AIDiagnosis` condition/confidence/recommendation object maps to an unreviewed `symptom_summary`/`care_navigation` artifact and must lose diagnostic wording. This resolves `CAP-P0-08`.

## 8. Pharmacy and inventory

### 8.1 Prescription validation and order state

| Prescription validation state | Allowed next states |
|---|---|
| `pending` | `valid`, `invalid`, `needs_clarification` |
| `needs_clarification` | `pending`, `valid`, `invalid` |
| `valid` | —; a later revocation/expiry is a new validation event that blocks future fulfilment |
| `invalid` | — |

| Pharmacy order state | Allowed next states | Required behavior |
|---|---|---|
| `received` | `awaiting_validation`, `cancelled` | Intake is recorded; no stock is reserved. |
| `awaiting_validation` | `validated`, `stock_reserved`, `rejected`, `cancelled` | One serializable command records validation and attempts FEFO reservation. Valid + available stock ends at `stock_reserved`; valid + unavailable stock ends at `validated` with a failed-reservation outcome. |
| `validated` | `stock_reserved`, `cancelled` | A retry rechecks stock and records reservations or another reasoned failed attempt atomically. |
| `stock_reserved` | `fulfilling`, `cancelled` | Cancellation atomically releases active reservations. |
| `fulfilling` | `ready_for_dispatch`, `cancelled` | Cancellation posts compensating inventory movements where preparation consumed stock. |
| `ready_for_dispatch` | `dispatched`, `cancelled` | Dispatch atomically consumes reservations/posts stock and creates the dispatch job. |
| `dispatched` | `delivered`, `delivery_exception` | Delivery events drive this projection. |
| `delivery_exception` | `ready_for_dispatch`, `returned` | Reviewed redispatch or return workflow is required. |
| `delivered` | — | Terminal successful fulfilment. |
| `returned` | — | Terminal; return/stock events remain separate immutable records. |
| `rejected` | — | Terminal validation outcome. |
| `cancelled` | — | Terminal pre-dispatch outcome with reason. |

| Stock reservation state | Allowed next states |
|---|---|
| `active` | `consumed`, `released`, `expired` |
| `consumed` | — |
| `released` | — |
| `expired` | — |

Portal `new`, `accepted`, `preparing`, `in-prep` and `delivered` are UI aliases/projections; they do not become additional order states. Transition to `validated` or `stock_reserved` requires a current `valid` prescription-validation event. A direct `awaiting_validation → stock_reserved` command appends both validation and reservation/order events in the same transaction. All rollback behavior is compensating and event-based: immutable stock movements, validations and dispatch records are never deleted or rewritten.

### 8.2 Inventory and procurement state

| Enum | Values |
|---|---|
| `inventory_batch_status` | `available`, `quarantined`, `recalled`, `expired`, `depleted` |
| `purchase_order_status` | `draft`, `submitted`, `approved`, `ordered`, `partially_received`, `received`, `cancelled` |
| `return_status` | `requested`, `approved`, `rejected`, `received`, `completed`, `cancelled` |
| `reconciliation_status` | `draft`, `submitted`, `approved`, `posted`, `rejected` |

Stock movement types are `receipt`, `reservation_consumed`, `dispatch`, `return`, `adjustment_positive`, `adjustment_negative`, `transfer_in` and `transfer_out`. Balances are projections from immutable ledger movements and active reservations. Controlled-substance events use dedicated permissions and reason codes; they are not ordinary editable stock rows.

## 9. Dispatch, delivery and driver state

### 9.1 Shared dispatch mechanics

| Enum | Values/transitions |
|---|---|
| `dispatch_job_status` | `pending` → `offering` → `assigned` → `in_progress` → `completed`; alternatives `cancelled`, `failed` |
| `dispatch_offer_status` | `pending` → `accepted`, `declined`, `expired`, or `withdrawn` |
| `dispatch_assignment_status` | `assigned` → `en_route_pickup` → `arrived_pickup` → `picked_up` → `en_route_dropoff` → `arrived_dropoff` → `completed`; alternatives `cancelled`, `failed` |
| `driver_availability_status` | `offline`, `available`, `busy`, `suspended` |

An accepted offer and assignment are created atomically; all competing pending offers are withdrawn. Patient name, phone and exact address are omitted from offer summaries and disclosed only after an active assignment passes policy. One driver/vehicle cannot hold overlapping active assignments unless an explicit team-response policy permits it.

### 9.2 Pharmacy delivery state

| State | Allowed next states |
|---|---|
| `awaiting_dispatch` | `assigned`, `cancelled` |
| `assigned` | `picked_up`, `cancelled`, `failed` |
| `picked_up` | `in_transit`, `failed` |
| `in_transit` | `delivered`, `failed` |
| `delivered` | — |
| `failed` | —; recovery creates a reviewed replacement/return workflow |
| `cancelled` | — |

Pickup and delivery transitions require server time, actor, assignment, geospatial evidence where available and configured proof. Completion posts the driver earning event atomically. Driver `Available`, `Delivered` and `Cancelled` mock strings map to offer/delivery projections rather than one mixed order status.

Pharmacy delivery and emergency response use the shared dispatch mechanism but never share the same domain aggregate or state enum. An ambulance mock entry cannot be accepted through a pharmacy delivery command. This resolves `CAP-P0-06`.

## 10. Emergency state

### 10.1 Event, triage and unit state

| Enum | Values |
|---|---|
| `emergency_event_status` | `created`, `triaged`, `dispatching`, `unit_assigned`, `responding`, `on_scene`, `transporting`, `resolved`, `cancelled`, `false_alarm` |
| `triage_priority` | `unknown`, `low`, `medium`, `high`, `critical` |
| `emergency_unit_status` | `available`, `reserved`, `en_route`, `on_scene`, `transporting`, `out_of_service` |
| `emergency_resolution_type` | `treated_on_scene`, `transported`, `cancelled_by_requester`, `false_alarm`, `duplicate`, `other` |

Normal event progression is `created → triaged → dispatching → unit_assigned → responding → on_scene`, then either `transporting → resolved` or direct `resolved`. `cancelled` and `false_alarm` are terminal reasoned outcomes. Resolution requires notes, resolver, resolution type and computed response duration.

Portal values `critical`, `dispatched` and `pending` currently mix triage priority with lifecycle state. They split into `triage_priority` plus `emergency_event_status`. Outcome labels such as stable/critical/deceased/refused are clinical outcome fields, not lifecycle states. Break-glass follows `policy-matrix.md` and never arises merely from an event status.

## 11. Finance, support and operational state

| Enum | Values |
|---|---|
| `withdrawal_status` | `requested`, `under_review`, `approved`, `processing`, `paid`, `failed`, `rejected`, `cancelled` |
| `payout_run_status` | `draft`, `approved`, `processing`, `completed`, `partially_failed`, `failed`, `cancelled` |
| `support_ticket_status` | `open`, `assigned`, `in_progress`, `waiting_requester`, `resolved`, `closed` |
| `support_ticket_priority` | `low`, `medium`, `high`, `urgent` |
| `export_job_status` | `queued`, `running`, `completed`, `failed`, `expired`, `cancelled` |
| `outbox_status` | `pending`, `processing`, `processed`, `failed`, `dead_letter` |

Outbox transitions are `pending → processing → processed`; transient delivery failure moves `processing → failed`, then scheduled retry moves `failed → pending`. Exhausted/non-retryable failure moves `failed → dead_letter`. An expired worker lease may safely return `processing → pending` using compare-and-set ownership.

Financial completion always means immutable balanced ledger postings exist. Changing a cached wallet/balance field is not a financial state transition. Support `in-progress` maps to `in_progress`; notification `sent` maps to delivery records, not content lifecycle.

### 11.1 Canonical domain-event envelope

Every persisted outbox event and published AsyncAPI domain event carries:

| Field | Rule |
|---|---|
| `event_id` | Server UUIDv7; consumer inbox deduplicates on `(consumer_name, event_id)`. |
| `event_type` | Stable dotted name such as `appointment.confirmed`; no version hidden in display text. |
| `event_version` | Positive schema version integer. Breaking payload changes increment it. |
| `aggregate_type`, `aggregate_id` | Authoritative subject of the event. |
| `aggregate_version` | Monotonic per aggregate; consumers detect gaps/reordering. |
| `organization_id`, `site_id` | `organization_id` is required for all organization-owned domain events and null only for true platform-global aggregates. `site_id` is required for site-owned events, null for organization-wide/global events. |
| `occurred_at`, `published_at` | UTC server timestamps; `published_at` is nullable until successful publication. |
| `actor_profile_id` | Nullable for system/provider events; never inferred from payload text. |
| `correlation_id`, `causation_id` | Trace the originating request/event and immediate cause. |
| `idempotency_key` | Present when the originating command was externally retryable. |
| `partition_key` | Normally `aggregate_id`; ordering is guaranteed only within a partition/aggregate. |
| `payload` | Versioned domain fields containing minimum necessary data; no secrets or unrestricted PHI. |

The outbox row and domain state commit atomically. MQTT packet deduplication uses the device key defined in Section 6, while API/event consumers use idempotency or inbox records. Dead-letter replay preserves `event_id`, event version, causation and original occurrence time; it records a new delivery attempt rather than creating a semantically new domain event.

## 12. Identifier, route and idempotency rules

All detail commands/queries require a canonical resource ID in the path or an unambiguous nested parent path. UI routes may differ, but transport contracts use examples such as:

```text
/api/v1/doctors/{doctor_id}
/api/v1/doctors/{doctor_id}/slots
/api/v1/appointments/{appointment_id}
/api/v1/consultations/{consultation_id}
/api/v1/conversations/{conversation_id}/messages
/api/v1/prescriptions/{prescription_id}
/api/v1/iot/devices/{device_id}
/api/v1/ai/artifacts/{artifact_id}
/api/v1/pharmacy/orders/{pharmacy_order_id}
/api/v1/dispatch/jobs/{dispatch_job_id}
/api/v1/emergencies/{emergency_event_id}
```

Mobile routes that currently render hardcoded resources must carry the corresponding ID and fetch an authorized read model. Missing resources return `404`; inaccessible resources also return concealed `404` where existence is sensitive, otherwise the stable policy errors in `policy-matrix.md` apply.

Create/transition commands for appointments, payments/refunds, prescriptions, messages, IoT commands, AI generations, pharmacy reservations/dispatch, delivery completion, SOS and withdrawals require an `Idempotency-Key`. A key is scoped to actor, operation and request fingerprint; reusing it with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`. This resolves `CAP-P0-09` and the ID/idempotency portion of `CAP-P0-04`.

## 13. Client-to-canonical mapping summary

| Existing client value/shape | Canonical treatment |
|---|---|
| Appointment `upcoming` | Derived read category over active future appointments |
| Appointment `scheduled` | `confirmed` after hold/payment invariants succeed |
| Appointment `rescheduled` | Old appointment `cancelled` with reason `rescheduled` plus replacement link/event |
| Appointment `in-person` / `In-Person` | `in_person` |
| Floating fee such as `50.0` | `amount_sen: 5000`, `currency: MYR` |
| Route-generated transaction ID | Server/provider reference; client supplies only idempotency key |
| Message `isMe` | Compare authenticated profile to server `sender_profile_id` |
| Message `isRead` | Per-participant `read_at` receipt projection |
| IoT free-text `Normal` | Derived display from metric/quality/threshold evaluation; not reading status |
| AI `AIDiagnosis` | Non-diagnostic clinical-support artifact with provenance/review state |
| Pharmacy `new/accepted/preparing/in-prep` | Mapped projection of canonical validation/reservation/fulfilment states |
| Emergency status `critical/dispatched/pending` | Split into `triage_priority` and `emergency_event_status` |
| Driver mixed `ORD-*` and `AMB-*` | Separate pharmacy delivery and emergency aggregates; references are display-only |

## 14. Decision disposition

This catalogue selects the initial semantics for `CAP-P0-01` and `CAP-P0-04` through `CAP-P0-09`. Contract schemas may add fields and reviewed later-stage values, but must not copy conflicting mock strings or weaken the invariants here. Any semantic change updates this catalogue and dependent contracts through compatibility review.

The next WP-01 outputs are the OpenAPI 3.1 foundation, AsyncAPI foundation, vitals capacity calculation and isolated Dart/TypeScript generated-model compile gate. No domain implementation or database migration starts before those artifacts pass review.
