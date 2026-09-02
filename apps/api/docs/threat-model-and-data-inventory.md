# SmartCura threat model and privacy data inventory

**Status:** WP-09 partial. This document is derived from the schema, permissions and
provider boundaries that are actually implemented as of 29 July 2026. It is not a
completed `WP-09` gate: the gate additionally requires `WP-02D` deployment, a
restore drill and measured load/NFR evidence, none of which exist yet.

Malaysia PDPA is the governing framework. The correct claim is "designed against
PDPA requirements", never "certified compliant".

## 1. Scope and trust boundaries

| Boundary | Crosses | Trust |
|---|---|---|
| Flutter/portal client → NestJS API | HTTPS, `__Host-` session cookie, CSRF header | Client is untrusted. Route guards are UX only; every object decision is server-side. |
| API → PostgreSQL | Private Docker network | Database is the authority. Constraints and triggers, not application code, are the last line. |
| API/worker → Cloudflare R2 | HTTPS, short-lived presigned capability | Bucket is private. Clients never hold long-lived credentials. |
| Worker → FCM / LiveKit / OpenAI-compatible LLM | HTTPS, after commit | External. Payloads are minimum-data or opaque. |
| Device → Mosquitto → ingestion | MQTT/TLS, per-device credential | Device identity comes from the broker credential and topic. Payload `patient_id` is ignored. |
| Firebase → API | ID token verified against Google JWKS | Identity only. No role or clinical claim is trusted from a token. |

## 2. Assets, ranked by consequence of disclosure

1. Clinical content: notes, prescriptions, AI artifact content, consultation transcripts.
2. Raw vitals and derived health alerts.
3. Identity and contact data: name, email, phone, IC-equivalent identifiers.
4. Credentials: session tokens, device secrets, FCM registration tokens, provider keys.
5. Authorization state: memberships, permissions, consents, care assignments.
6. Audit and financial records.

## 3. Threats and implemented mitigations

Each mitigation below names an implemented mechanism, not an intention.

| # | Threat | Implemented mitigation | Residual risk |
|---|---|---|---|
| T1 | Client forges role or permission | Roles/permissions live in PostgreSQL; tokens carry no authority; `evaluatePermission` plus object policy on every route | None known at this layer |
| T2 | TOCTOU: authority revoked between guard and write | Actor revalidation inside the mutation transaction under row lock (`revalidateActor`, `revalidateClinicalActor`, `revalidateSchedulingActor`) | Requires every new mutation to adopt the pattern |
| T3 | Cross-patient clinical read | Own/assigned/organization/global scopes; assigned access requires an active care assignment re-proved under lock; unauthorized reads answered as concealed `404` | Break-glass path is designed but not implemented |
| T4 | Double booking / oversold capacity | One-appointment-per-slot UNIQUE, GiST doctor-overlap exclusion, patient advisory-lock serialization, bounded SERIALIZABLE retries | Concurrency proof requires a real database (deferred) |
| T5 | Tampering with signed clinical records | Triggers refuse to mutate signed note content, signed prescription rows and their items; corrections create superseding versions | Trigger execution unproven without PostgreSQL |
| T6 | AI performing a clinical action | No AI table references `prescriptions`, `health_alerts`, `appointments` or `clinical_notes`; safety filter blocks diagnostic, medication and emergency-suppression wording; `non_diagnostic` CHECK; doctor-only review asserted in migration | Prompt injection can still degrade output quality; review is the control |
| T7 | Fabricated AI certainty presented as clinical fact | Cross-table trigger permits `confidence` only when the model declares a calibrated score; both LLM rows declare false | — |
| T8 | Malware uploaded through file intake | Finalize → scan → clean-only promotion; magic-byte and checksum re-verification; quarantine on mismatch | Real ClamAV/R2 unproven |
| T9 | Private object enumeration or leakage | Opaque object keys, 60-second presigned downloads bound to policy, object key never returned, opaque `404` for unrelated callers | Bucket policy unverified until `WP-02D` |
| T10 | Duplicate or replayed device packets | Global `(device_id, boot_id, sequence_number)` claim ledger outside the partitioned table | 30-day replay window is a deliberate tradeoff |
| T11 | Spoofed device claiming another patient | Device identity from broker credential/topic; ownership resolved from time-valid assignment; payload patient ids ignored | Broker ACLs unverified |
| T12 | PHI leaking into logs | Allowlist log projection (`safeLogFields`); nested values and unlisted keys withheld; error messages never logged; 7 redaction tests | Log sinks outside the process are not yet configured |
| T12b | PHI or high-cardinality identifiers leaking into metrics/spans | Stricter metric-label allowlist (`safeMetricLabels`): no identifier may be a label at all, values bounded to 64 characters, UUID-like and long digit runs refused even under a permitted name, paths normalised by `routeLabel`, status collapsed by `httpStatusClass`; 4 tests | No metrics exporter is wired yet, so the boundary is unused until one is |
| T13 | Credential disclosure from the database | Session tokens and device secrets stored as SHA-256 digests; FCM tokens AES-256-GCM sealed and indexed by hash | Key management deferred to `WP-02D` |
| T14 | Push payload disclosing clinical content | Push carries only opaque `notification_id`/resource ids; clients refetch through authorized reads | — |
| T15 | Prompt injection via patient text | Message `role` is server-assigned; a request cannot inject `assistant`/`system` turns | Content-level injection remains possible |
| T16 | Replayed or duplicated commands | `Idempotency-Key` scoped to actor/operation/request hash, claimed inside the transaction with stored-response replay | — |
| T17 | Audit tampering | Append-only triggers on audit, status history, review, escalation and acknowledgement tables; application role cannot update/delete audit rows | Grant enforcement unproven without a real role |
| T18 | Single VPS failure domain | Documented requirement for snapshots plus encrypted independent off-site backup | **Unmitigated today.** No backup exists; restore drill is a `WP-09` gate item |

## 4. Privacy data inventory

| Class | Representative tables | Purpose | Leaves platform? | Retention |
|---|---|---|---|---|
| Identity/contact | `profiles`, `patient_addresses`, `emergency_contacts` | Authentication, care coordination | Firebase holds identity/MFA metadata only | Account lifetime |
| Authorization | `organization_memberships`, `role_permissions`, `patient_consents`, `care_assignments` | Access control | No | Account lifetime + audit |
| Clinical narrative | `clinical_notes`, `consultations`, `messages` | Care delivery | No | Permanent per clinical policy |
| Medication | `prescriptions`, `prescription_items` | Prescribing, dispensing | Pharmacy intake event carries IDs only | Permanent |
| Vitals | `vital_readings` (partitioned), aggregates | Monitoring | No | Raw by partition retention; aggregates longer |
| Alerts | `health_alerts`, `health_alert_escalations` | Escalation | Push carries opaque IDs only | Audit-aligned |
| AI | `ai_messages`, `ai_artifacts`, `ai_candidates` | Non-diagnostic support | Minimised prompt text to the OpenAI-compatible provider when enabled | Version history retained |
| Files | `stored_objects`, `prescription_documents` | Evidence, PDFs | Bytes in Cloudflare R2 (private) | Linked-record lifetime |
| Credentials | `app_sessions`, `device_credentials`, `push_devices` | Authentication | FCM token to Google when push enabled | Rotation/revocation |
| Audit | `audit_logs`, status-history tables | Accountability | No | Long retention, append-only |

### Subprocessors

Firebase Auth/FCM, Cloudflare R2, the OpenAI-compatible LLM provider (when enabled), the selected VPS provider
and the independent backup vendor. Regions and cross-border handling are decided in
`WP-02D`. FCM and outbox events carry opaque identifiers, never diagnoses or vitals.

## 5. What this document does not establish

- No restore drill has been performed; there is no verified backup.
- No k6 load run or measured NFR report exists.
- No penetration test or dependency-audit report is attached.
- Break-glass emergency access is designed but unimplemented.
- No metrics exporter or tracing pipeline is wired yet; the label boundary exists but is currently unused.

`fyp-core-ready` therefore remains unclaimed.
