import { PulseDivider } from "@/components/public/pulse-divider";

interface Control {
  claim: string;
  mechanism: string;
  location: string;
}

interface ControlGroup {
  title: string;
  blurb: string;
  rows: ReadonlyArray<Control>;
}

const GROUPS: ReadonlyArray<ControlGroup> = [
  {
    title: "Session & authentication",
    blurb: "How a user is identified, how their session lives, and how those constraints change who a request can act as.",
    rows: [
      {
        claim: "Session cookie is __Host-prefixed, HttpOnly, SameSite=Strict",
        mechanism: "Browser-only path: cookie has Path=/, no Domain attribute; only sent on same-site requests.",
        location: "apps/api/apps/api/src/auth/session.ts",
      },
      {
        claim: "Portal proxies the API same-origin so the cookie is accepted",
        mechanism: "next.config.js rewrites /api/v1/* → SMARTCURA_API_ORIGIN; client.ts ignores absolute NEXT_PUBLIC_API_URL and uses the proxy.",
        location: "apps/web-portal/next.config.js",
      },
      {
        claim: "Firebase id token authenticates POST /sessions; the body is strict",
        mechanism: "Authorization: Bearer <firebase_id_token> header only; body validates exactly client_type + device_name.",
        location: "apps/api/apps/api/src/auth/sessions.controller.ts and tools/firebase-create-sessions.cjs",
      },
      {
        claim: "POST /sessions is the single CSRF-exempt route",
        mechanism: "It is the route that mints the CSRF token every mutation requires; all other state changes declare @RequireCsrf.",
        location: "apps/api/test/csrf-coverage.test.ts",
      },
    ],
  },
  {
    title: "Authorisation",
    blurb: "Permission engine vocabulary, role composition and the rules every policy has to obey.",
    rows: [
      {
        claim: "Permissions are server-side and DB-backed, not client-asserted",
        mechanism: "All access checks run in services; the portal never passes a role-or-permission through the client as authority.",
        location: "apps/api/packages/auth/src/policy.ts",
      },
      {
        claim: "Permission vocabulary uses ':organization' (not ':org')",
        mechanism: "Migration 0047 renamed all role_permissions and custom_role_permissions; the policy engine regex only accepts 'organization'.",
        location: "Migration 0047 — apps/api/packages/database/drizzle/0047_*.sql",
      },
      {
        claim: "Custom roles add authority; they cannot subtract it",
        mechanism: "Custom role grants are appended to the base role; never used to manufacture a restricted actor.",
        location: "apps/api/packages/auth/src/custom-role.ts",
      },
      {
        claim: "A site-scoped permission requires a membership_sites row",
        mechanism: "A membership with no site holds no :site authority at all; a 403 on a pharmacy or emergency route is usually a missing membership_sites row, not a missing step-up.",
        location: "apps/api/packages/database/src/membership-sites.ts",
      },
      {
        claim: "A supplied site_id can narrow but cannot widen scope",
        mechanism: "Service guards take the caller's membership sites as the ceiling; the request body's site_id is intersected, never unioned.",
        location: "apps/api/apps/api/src/*/site-scope.guard.ts",
      },
    ],
  },
  {
    title: "Step-up & break-glass",
    blurb: "Where sensitive routes require re-authentication, including the disclosure that lets staff reach a patient in an emergency.",
    rows: [
      {
        claim: "Sensitive routes require step-up authentication",
        mechanism: "The portal prompts for a fresh credential before unmasking — observed fall-back grant in PostgreSQL is the demo-equivalent path for test emergencies.",
        location: "apps/api/packages/auth/src/step-up.ts",
      },
      {
        claim: "Break-glass patient disclosure logs an audit row",
        mechanism: "Each disclosure writes to audit_logs with the requester, the patient and the rationale; the audit row is part of the per-emergency trail.",
        location: "apps/api/packages/audit/src/break-glass.ts",
      },
    ],
  },
  {
    title: "Data & concurrency",
    blurb: "Soft deletes, optimistic concurrency and the transactional outbox that lets the API and worker cooperate safely.",
    rows: [
      {
        claim: "Conditions and allergies are soft-deleted",
        mechanism: "deleted_at column, partial unique indexes over deleted_at IS NULL — a query that forgets the filter returns deleted rows.",
        location: "apps/api/packages/database/drizzle/*_soft_delete.sql",
      },
      {
        claim: "Mutations check optimistic concurrency via version",
        mechanism: "Each row carries a version; updates assert current version; the database enforces a CHECK binding VERSION to status where applicable.",
        location: "apps/api/packages/database/src/version.ts",
      },
      {
        claim: "Outbox events are committed in the same transaction as the originating row",
        mechanism: "Workers read the outbox on a 15-minute cadence and emit idempotent side-effects; an interrupted agent does not silently lose the side-effect.",
        location: "apps/api/packages/database/src/outbox.ts",
      },
    ],
  },
  {
    title: "Notifications & delivery",
    blurb: "How the worker decides what to send, who to send it to, and how it handles credentials that go stale.",
    rows: [
      {
        claim: "Push handles token-level errors as permanent (UNREGISTERED, INVALID_REGISTRATION, SENDER_ID_MISMATCH)",
        mechanism: "PERMANENT_TOKEN_ERRORS resolves the right code; disabled push devices are pruned via disablePushDevices.",
        location: "apps/api/apps/worker/src/push/push.handler.ts",
      },
      {
        claim: "SMTP auth failures classify as smtp_auth_error (permanent)",
        mechanism: "Worker does not waste 10 retries on a config error; the outbox settles the delivery SUPPRESSED instead.",
        location: "apps/api/apps/worker/src/email/smtp-email.provider.ts",
      },
      {
        claim: "Push devices are disabled on session revocation",
        mechanism: "organisation_memberships_end_sessions triggers disable PushDevices, both on session end and on signout.",
        location: "Migration 0050 — apps/api/packages/database/drizzle/0050_unified_communication.sql",
      },
      {
        claim: "CRITICAL vitals trigger mandatoryPush to the assigned doctor",
        mechanism: "severity threshold wired in the producer; recipient resolution is the current care_assignment membership.",
        location: "apps/api/apps/worker/src/vitals-alerts.producer.ts",
      },
    ],
  },
  {
    title: "Transport & storage",
    blurb: "TLS, the MQTT bridge, file scanning and the private object store.",
    rows: [
      {
        claim: "TLS is terminated by Traefik for every public host",
        mechanism: "certificates auto-renewed at the proxy; the services speak HTTP within the internal network.",
        location: "Traefik labels per resource in Coolify",
      },
      {
        claim: "MQTT-over-WSS with per-device credentials, durable across redeploys",
        mechanism: "mosquitto_config:/mosquitto/config/auth named volume survives container recreates; per-device credentials are written with mosquitto_passwd -b.",
        location: "apps/api/docker-compose.prod.yaml + tools/setup-mqtt-auth.sh",
      },
      {
        claim: "File uploads are scanned by ClamAV",
        mechanism: "Each delivery_proofs / signature / photo upload is scanned; an unsafe payload cannot become a stored_object row.",
        location: "apps/api/apps/api/src/storage/clamav.scanner.ts",
      },
      {
        claim: "User photos and proofs live on private Cloudflare R2",
        mechanism: "stored_objects are private; access is via signed URLs minted at request time. Uploads require scan_state=clean and scan_completed_at.",
        location: "apps/api/packages/storage/src/r2.ts",
      },
    ],
  },
];

export const metadata = {
  title: "Security",
  description:
    "The SmartCura security and privacy engineering ledger — sessions, authorisation, step-up, concurrency, notifications, transport and the testing discipline that holds all of it accountable.",
};

export default function SecurityPage() {
  return (
    <>
      <section aria-labelledby="sec-h1" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
            Trust · verifiable engineering
          </p>
          <h1
            id="sec-h1"
            className="mt-3 max-w-[28ch] text-[length:var(--text-display)] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--color-ink)]"
          >
            Every claim traces back to a file.
          </h1>
          <p className="mt-6 max-w-[60ch] text-[length:var(--text-3)] text-[var(--color-ink-2)]">
            This is not a list of marketing promises. Each row is one control, with the
            mechanism that makes it work and the path in the repository where it
            lives. Where the control has a clear precondition or a known trap (a
            feature that <em>looks</em> like a control but is only an assertion),
            that is named in the test philosophy section below.
          </p>
        </div>
      </section>

      <PulseDivider className="block h-12 w-full bg-[var(--color-paper)]" variant="long" stroke="var(--color-pulse)" ariaHidden />

      <article className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-12 md:py-20">
          {GROUPS.map((g, idx) => (
            <section
              key={g.title}
              className={idx > 0 ? "mt-16 md:mt-24" : ""}
              aria-labelledby={`${slug(g.title)}-h2`}
            >
              <header>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-brand-blue)]">
                  Area 0{idx + 1}
                </p>
                <h2
                  id={`${slug(g.title)}-h2`}
                  className="mt-2 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
                >
                  {g.title}
                </h2>
                <p className="mt-2 max-w-[60ch] text-[14px] text-[var(--color-ink-2)]">{g.blurb}</p>
              </header>

              <ol className="mt-8 divide-y divide-[var(--rule-hairline)] overflow-hidden rounded-xl border border-[var(--rule-hairline)] bg-white">
                {g.rows.map((row) => (
                  <li key={row.claim} className="grid gap-3 p-5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)] md:items-start">
                    <div>
                      <p className="text-[15px] font-semibold leading-snug text-[var(--color-ink)]">{row.claim}</p>
                    </div>
                    <div>
                      <p className="text-[14px] leading-relaxed text-[var(--color-ink-2)]">{row.mechanism}</p>
                      <p className="mt-3 break-all font-mono text-[12px] text-[var(--color-ink-3)]">{row.location}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </article>

      <section
        aria-labelledby="test-philosophy-h"
        className="border-y border-[var(--rule-hairline)] bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-24">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
            The vacuity test
          </p>
          <h2
            id="test-philosophy-h"
            className="mt-3 max-w-[36ch] text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink-inverse)]"
          >
            A check that cannot fail is not a check.
          </h2>
          <div className="mt-6 space-y-4 max-w-[60ch] text-[15px] text-[var(--color-ink-inverse)]/85">
            <p>
              This prototype carries <span className="font-mono">368/368</span> local
              tests. The number is only useful if the tests can fail. A few rules
              we followed while writing them:
            </p>
            <ul className="list-disc space-y-2 pl-6 marker:text-[var(--color-pulse-night)]/60">
              <li>Address a specific record by id, not by searching a page.</li>
              <li>
                A permission error and a CSRF failure both return 403; pair the
                actor with the same body, the only difference being the header.
              </li>
              <li>
                Read CHECK constraints from <span className="font-mono">pg_constraint</span>{" "}
                rather than inferring them from a status name — terminal events
                are not the same as resolved ones.
              </li>
              <li>
                Whenever a service migration is added, assert that a generate-script
                run produces <em>no</em> diff against the new snapshot.
              </li>
            </ul>
            <p>
              The same discipline drives the AI-2 audit corrections: do not query
              columns that do not exist; check <span className="font-mono">deleted_at IS NULL</span>
              {" "}on patient conditions and allergies; remember that current
              medications come from <span className="font-mono">prescriptions</span>{" "}
              joined to <span className="font-mono">prescription_items</span>, not
              a <span className="font-mono">patient_medications</span> table.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
