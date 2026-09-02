# Dependency audit and production dependency-graph note

**Status:** Procedure documented; no vulnerability result is claimed by this note. `npm audit` was not run as part of creating this artefact, so advisory counts and severities are **unmeasured**.

## 1. Reproducible audit commands

Use the repository-pinned npm version (`packageManager: npm@10.9.2`) and committed backend lockfile. On CI or a clean review environment:

```powershell
npm ci
npm audit
npm audit --omit=dev
npm audit --json | Out-File -Encoding utf8 npm-audit-all.json
npm audit --omit=dev --json | Out-File -Encoding utf8 npm-audit-production.json
npm run check
```

- `npm audit` covers the complete installed dependency graph, including development tooling.
- `npm audit --omit=dev` focuses the production install graph; it does not replace the full audit because compromised build/test tooling is still a supply-chain risk.
- Preserve Node/npm versions, UTC time, lockfile hash, raw JSON, exit codes, triage decision, owner, and remediation deadline.
- Never run `npm audit fix --force` blindly. A breaking or transitive change requires review, exact pinning, `npm run check`, and targeted runtime/integration evidence.
- If registry/network access is unavailable, record the audit as **not executed**, not “clean.”

## 2. Pinned-version policy

The design of record requires one npm workspace lockfile and exact direct dependency versions: no `^`, `~`, `latest`, or unpinned container image tags. CI uses `npm ci` so resolution follows the lockfile rather than silently updating it. New dependencies must be justified, checked for name confusion/typosquatting, pinned exactly, and reviewed for maintenance, license, transitive size, advisories, and runtime reachability.

Audit triage distinguishes:

1. **Runtime reachable:** update/replace urgently; show the vulnerable path and exercised surface.
2. **Production installed but not reachable:** still remediate or document a time-bounded exception with evidence.
3. **Development/build only:** assess CI and generated-artifact exposure; do not dismiss automatically.
4. **False positive/not applicable:** record package path, advisory, reason, reviewer, and recheck date.

A zero advisory count is not a security certification. It is a timestamped result against the registry's advisory data at that moment.

## 3. Production mock-provider graph guarantee

`test/production-dependency-graph.test.ts`, included by the root `npm test` and therefore `npm run check`, enforces three properties:

1. It recursively discovers TypeScript classes under `apps/api/src`, `apps/worker/src`, and `packages` whose names begin with `Mock`, `Deterministic`, `Fake`, `Stub`, or `InMemory`.
2. Every discovered mock-shaped provider must appear in an explicit registry that records a production guard file, the guard text, and why shipping that provider would be harmful.
3. Every registry entry must still have a production refusal in its configuration/factory, and every consequence explanation must remain substantive.

The current registry covers deterministic appointment payment, deterministic push, mock LLM, deterministic malware scan, deterministic local identity, and in-memory object storage (including a factory-level defence in depth). This protects against a new obvious mock class silently entering production configuration and against deleting a known production guard.

### Guarantee boundary

The test is a source-level, naming-convention-based guard—not a full bundler call-graph proof. It does **not** establish that:

- every possible non-production implementation uses one of the recognised class-name prefixes;
- real provider adapters are implemented or operational;
- a provider credential, network route, or remote service works;
- npm dependencies have no vulnerabilities;
- a production image contains only runtime files.

Accordingly, the honest claim is: **all currently discovered mock-shaped provider classes have an explicit, tested production refusal decision.** Do not shorten this to “production contains no mock code” or “production providers work.” Process-level boot refusal and image/SBOM inspection should supplement this test in a deployed environment.

## 4. Report template

| Field | Value |
|---|---|
| UTC / commit / lockfile SHA-256 | **UNMEASURED** |
| Node / npm version | **UNMEASURED** |
| `npm ci` result | **UNMEASURED** |
| Full audit counts | **UNMEASURED — not run** |
| Production audit counts | **UNMEASURED — not run** |
| Accepted exceptions | **UNMEASURED** |
| `npm run check` | Populate from the verification record for the same commit |
| Production graph test | Populate from `npm run check`; do not infer provider operability |
| Reviewer / next audit date | **UNASSIGNED** |
