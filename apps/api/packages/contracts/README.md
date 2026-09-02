# SmartCura Contracts

**Status:** Stage 0A canonical contract foundation
**Contract version:** 0.1.0

This package is the source of truth for REST, Socket.IO, MQTT and transactional-outbox message shapes. It contains no backend business implementation.

## Contents

- `openapi/openapi.json`: OpenAPI 3.1 foundation for health, readiness, sessions, active-role selection and own profile.
- `asyncapi/asyncapi.json`: AsyncAPI 3.0 foundation for Socket.IO, MQTT and PostgreSQL outbox processing.
- `scripts/validate-contracts.mjs`: dependency-free structural/reference and SmartCura invariant checks.
- `scripts/generate-models.mjs`: deterministic dependency-free TypeScript and Dart model generation from OpenAPI schemas.
- `scripts/check-generated-models.mjs`: isolated TypeScript type-check plus Dart analysis/kernel compilation.
- `generated/typescript/models.ts`: generated TypeScript contract models.
- `generated/dart/lib/smartcura_contracts.dart`: generated Dart contract models.

Generated model files are never edited manually. Their adjacent compile configuration and smoke-check files are maintained source files.

## Commands

From `apps/api/packages/contracts`:

```text
npm ci
npm run check
```

`npm run check` validates both contracts, rewrites both generated model files, type-checks TypeScript with strict/no-emit settings, analyzes the dependency-free Dart package, and compiles its smoke check to a temporary kernel file outside the repository. The TypeScript compiler is selected in this order: `TSC`, contract-local installation, the existing portal installation, then global `tsc`.

Generation is byte-for-byte deterministic. CI installs the pinned TypeScript version, runs the complete check, and fails when regenerated model output differs from the committed files. Dart compilation uses SDK 3.12.2 in CI.

## REST compatibility

1. The public base path is `/api/v1`; a breaking API generation creates `/api/v2`.
2. Additive optional response fields and new endpoints are compatible within v1.
3. Removing/renaming a field or operation, narrowing a type/range, changing semantics, or adding a required request field is breaking.
4. Adding an enum value is treated as compatibility-sensitive: generated clients include an unknown fallback at decode boundaries, and release notes must identify it.
5. Deprecated operations/fields remain available for at least 90 days and one released client migration cycle. Responses expose `Deprecation` and `Sunset` headers where applicable.
6. RFC 9457 Problem Details `code` values are stable. Existing codes are never reused for a different condition.
7. Cursor values are opaque. Clients persist/pass them but never parse them.
8. Servers reject unknown request fields. Responses may add documented optional fields under this policy.

## Async compatibility

1. Socket.IO event names and MQTT topics include a major version suffix/path (`.v1` or `/v1/`).
2. Each domain event carries a positive `event_version`. Additive optional payload fields keep the version; required/removal/type/semantic changes increment it.
3. Consumers support the current and immediately previous event schema version during migration.
4. New event types are additive. Renaming/removing an event or changing its room/topic, direction, QoS, retain behavior or ordering guarantee is breaking.
5. MQTT breaking changes use a new topic major such as `smartcura/v2/...`; devices never infer a schema from firmware version.
6. QoS 1 means duplicates are expected. Device ingestion deduplicates by authenticated device, boot, sequence and metric; commands/acks correlate by `command_id`.
7. Socket.IO is notification, not the source of truth. On reconnect/gap, `sync.required.v1` directs clients to cursor-based REST catch-up.
8. Outbox replay preserves `event_id`, schema version, causation and original occurrence time.

## Security and data rules

- Firebase bearer identity is accepted only by session bootstrap and, together with an active session cookie, refresh/step-up.
- Protected REST and Socket.IO use `__Host-smartcura_session`; browser tokens are never stored in JavaScript/localStorage.
- Device identity comes from MQTT credentials and ACL-bound topic. Payload patient IDs are forbidden.
- Events and push payloads contain minimum necessary data. FCM receives opaque event/resource identifiers, not diagnoses or raw vitals.
- Internal outbox topology is PostgreSQL worker claiming, not a public message broker.

## Generated-client rules

- OpenAPI component schemas are the only generation input for these foundation models.
- JSON wire properties remain `snake_case`; TypeScript interfaces preserve them exactly.
- Dart fields use idiomatic `lowerCamelCase`; serialization adapters generated in the implementation stage must map canonical wire names explicitly.
- Dates remain ISO/RFC 3339 strings in generated transport models until a reviewed serializer layer maps them.
- Generated models are transport types. Clients map them to UI/domain view models instead of importing them throughout widgets/components.
- A generated file includes its source contract version and must be reproducible byte-for-byte.

## Stage 0A limits

This foundation intentionally defines only operations/platform identity/profile schemas and the first asynchronous channels. Domain endpoint DTOs are added slice-by-slice after their policy/state decisions. Passing this package's validation/compile gate does not mean backend behavior exists.
