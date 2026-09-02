/**
 * Non-authoritative session expiry warnings.
 *
 * The backend owns the application session: it issues the session id, enforces
 * idle and absolute deadlines, and revokes sessions. This module therefore never
 * creates session ids, never stores session state, and never grants or denies
 * access. It only reads the server-provided `idle_expires_at` /
 * `absolute_expires_at` timestamps from the latest bootstrap payload so the UI can
 * show a heads-up before the server ends the session.
 *
 * When a deadline passes, the only correct action is to ask the backend again
 * (`GET /sessions/current`) and follow its answer.
 */

import type { SessionView } from '@/types/session';

/** Minutes of remaining lifetime at which the UI should warn the user. */
export const SESSION_WARNING_THRESHOLD_MINUTES = 5;

export type SessionDeadlineKind = 'idle' | 'absolute';

export interface SessionExpiryStatus {
  /** Which server deadline comes first. */
  nextDeadline: SessionDeadlineKind;
  /** ISO-8601 timestamp of the nearest server deadline. */
  expiresAt: string;
  /** Whole minutes left until that deadline; never negative. */
  minutesRemaining: number;
  /** True when the nearest deadline is within the warning threshold. */
  shouldWarn: boolean;
  /** True when the server deadline has already passed; re-check with the backend. */
  expired: boolean;
}

function minutesUntil(iso: string, now: number): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.floor((target - now) / 60_000));
}

/**
 * Describes how close the server-side deadlines are. Purely informational.
 */
export function getSessionExpiryStatus(
  session: SessionView | null,
  options: { now?: Date; warningThresholdMinutes?: number } = {},
): SessionExpiryStatus | null {
  if (!session) return null;

  const now = (options.now ?? new Date()).getTime();
  const threshold = options.warningThresholdMinutes ?? SESSION_WARNING_THRESHOLD_MINUTES;

  const idle = Date.parse(session.idle_expires_at);
  const absolute = Date.parse(session.absolute_expires_at);
  if (Number.isNaN(idle) && Number.isNaN(absolute)) return null;

  const idleFirst = Number.isNaN(absolute) || (!Number.isNaN(idle) && idle <= absolute);
  const nextDeadline: SessionDeadlineKind = idleFirst ? 'idle' : 'absolute';
  const expiresAt = idleFirst ? session.idle_expires_at : session.absolute_expires_at;
  const minutesRemaining = minutesUntil(expiresAt, now);
  const expired = (idleFirst ? idle : absolute) <= now;

  return {
    nextDeadline,
    expiresAt,
    minutesRemaining,
    shouldWarn: !expired && minutesRemaining <= threshold,
    expired,
  };
}

/**
 * Schedules a one-shot warning callback ahead of the nearest server deadline.
 * Returns a cleanup function. This does not end the session — only the backend can.
 */
export function scheduleSessionWarning(
  session: SessionView | null,
  onWarn: (status: SessionExpiryStatus) => void,
  options: { now?: Date; warningThresholdMinutes?: number } = {},
): () => void {
  const status = getSessionExpiryStatus(session, options);
  if (!status || status.expired) return () => {};

  const threshold = options.warningThresholdMinutes ?? SESSION_WARNING_THRESHOLD_MINUTES;
  const now = (options.now ?? new Date()).getTime();
  const warnAt = Date.parse(status.expiresAt) - threshold * 60_000;
  const delay = Math.max(0, warnAt - now);

  const timer = setTimeout(() => {
    const current = getSessionExpiryStatus(session, options);
    if (current) onWarn(current);
  }, delay);

  return () => clearTimeout(timer);
}
