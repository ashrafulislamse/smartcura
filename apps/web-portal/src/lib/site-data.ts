/**
 * Single source of truth for every figure quoted on the public site.
 *
 * Re-run `node apps/web-portal/scripts/verify-numbers.mjs` to assert these stay
 * in lockstep with `tools/status.mjs` output (which writes `docs/STATUS.md`) and
 * with the dated addenda in AGENTS.md. Any drift fails the script.
 */

export interface MeasurableCounts {
  /** REST operations declared across controllers. */
  readonly restOperations: number;
  /** OpenAPI component/complex schemas (post-contracts regeneration). */
  readonly openApiSchemas: number;
  /** Effective SQL migration files in apps/api/packages/database/drizzle. */
  readonly migrations: number;
  /** Local test count after the most recent batch. */
  readonly localTests: number;
  /** Tables in the canonical schema. */
  readonly tables: number;
  /** Authenticated + unauthenticated portal pages. */
  readonly portalPages: number;
  /** Implemented AI Master Plan phases (AI-0 … AI-9). */
  readonly aiPhases: number;
  /** Human language surface count: patient, doctor, driver, web portal. */
  readonly surfaces: number;
}

export const MEASURED: MeasurableCounts = {
  restOperations: 251,
  openApiSchemas: 421,
  migrations: 64,
  localTests: 368,
  tables: 73,
  portalPages: 81,
  aiPhases: 10,
  surfaces: 4,
} as const;

export interface LiveHref {
  readonly label: string;
  readonly href: string;
  readonly description: string;
}

export const LIVE_HREFS: ReadonlyArray<LiveHref> = [
  {
    label: "Web portal",
    href: "https://portal.smartcura.app/",
    description:
      "Sign in to the authenticated dashboard. Test accounts are listed in TEST_USERS.md in the repository — credentials are intentionally not on this site.",
  },
  {
    label: "API health",
    href: "https://api.smartcura.app/api/v1/health",
    description:
      "Public health endpoint. Returns ok in well under 200 ms on the live VPS.",
  },
  {
    label: "LiveKit signalling",
    href: "https://livekit.smartcura.app/",
    description:
      "Telephony and video-consultation media server. Token-issued rooms only; nothing public on the wire.",
  },
  {
    label: "MQTT broker",
    href: "https://mqtt.smartcura.app:9001/mqtt",
    description:
      "TLS WebSocket MQTT listener (`Sec-WebSocket-Protocol: mqtt`). Per-device credentials carried by an explicit volume.",
  },
];

export const MEASURED_AT = "2026-08-20";

/** True when the request host should be served the marketing site, not the dashboard. */
export function isPublicHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const normalised = host.toLowerCase().split(":")[0] ?? "";
  if (normalised === "smartcura.app") return true;
  if (normalised === "www.smartcura.app") return true;
  if (normalised === "localhost") return true; // local dev
  // Treat explicit subdomains of the apex that aren't the portal as public.
  if (normalised.endsWith(".smartcura.app") && normalised !== "portal.smartcura.app") {
    return true;
  }
  return false;
}
