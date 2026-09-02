/**
 * Non-authoritative client breadcrumbs.
 *
 * The compliance audit trail lives in the backend. Every request the portal makes
 * is already recorded server-side with the session id, profile id, active role and
 * correlation id the backend itself assigned. The browser cannot be trusted as an
 * audit authority, so this module:
 *
 *  - never generates audit ids, session ids or retention metadata,
 *  - never persists anything (no localStorage, no sessionStorage),
 *  - never claims HIPAA/GDPR coverage for what it records,
 *  - keeps at most a small in-memory ring buffer for local debugging.
 *
 * Use it for developer diagnostics only. If an action must be auditable, it must
 * go through a backend endpoint.
 */

export type ClientEventLevel = 'debug' | 'info' | 'warn';

export interface ClientEvent {
  /** Short dot-separated name, e.g. `session.bootstrap` or `role.select`. */
  name: string;
  level: ClientEventLevel;
  /** Client clock only — never used for ordering server-side records. */
  observedAt: string;
  /** Backend correlation id when one is available from a response or problem+json. */
  correlationId?: string | null;
  details?: Record<string, unknown>;
}

const MAX_BUFFERED_EVENTS = 100;

class ClientBreadcrumbLog {
  private events: ClientEvent[] = [];

  record(
    name: string,
    options: {
      level?: ClientEventLevel;
      correlationId?: string | null;
      details?: Record<string, unknown>;
    } = {},
  ): void {
    const event: ClientEvent = {
      name,
      level: options.level ?? 'info',
      observedAt: new Date().toISOString(),
      correlationId: options.correlationId ?? null,
      details: options.details,
    };

    this.events.push(event);
    if (this.events.length > MAX_BUFFERED_EVENTS) this.events.shift();

    if (process.env.NODE_ENV === 'development') {
      // eslint-disable-next-line no-console
      console.debug('[client-breadcrumb]', event);
    }
  }

  /** Recent breadcrumbs, newest last. Debugging aid only. */
  recent(): ClientEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

export const clientBreadcrumbs = new ClientBreadcrumbLog();
