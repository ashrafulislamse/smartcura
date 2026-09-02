import { PostgresConnection } from './connection.js';

/**
 * Aggregate counts for the administrative dashboard.
 *
 * WHY THIS EXISTS AT ALL. The portal dashboard shows totals, and a total cannot honestly be
 * computed from a collection endpoint: every list here is bounded at 100 rows, so counting the
 * rows of a page would report `100` for any organization with more than that. A page that did
 * so would be quietly wrong exactly when the number started to matter.
 *
 * WHY EACH GROUP IS A SEPARATE METHOD. An aggregate is a way to learn the size of a set you may
 * not be allowed to enumerate, so every group is gated on the SAME permission as the collection
 * it summarises and the service calls only the methods the caller is permitted to use. The SQL
 * for a forbidden group is never executed, which is a stronger guarantee than computing
 * everything and filtering the response afterwards.
 *
 * WHY THERE IS NO "TODAY". A calendar day needs a timezone, and this schema stores none for an
 * organization — `timezone` is a per-profile preference, so any choice here would be an
 * invention that quietly disagreed with somebody's screen. The window is therefore stated as
 * the next 24 hours, which is unambiguous, needs no guess, and is the more useful figure for
 * an operational dashboard anyway.
 */
export interface AppointmentMetrics {
  total: number;
  startingWithin24h: number;
  active: number;
}

export interface EmergencyMetrics {
  active: number;
}

export interface SupportMetrics {
  open: number;
  breachingResolution: number;
}

export interface DoctorMetrics {
  listed: number;
  acceptingNewPatients: number;
}

export interface RevenueMetrics {
  capturedSen: number;
  currency: string;
  periodStart: Date;
}

/**
 * The statuses that mean an appointment is still a live commitment. `rescheduled` is absent
 * deliberately: that row is superseded and `replaced_by_appointment_id` names the booking that
 * now matters, so counting it would count one slot twice.
 */
const ACTIVE_APPOINTMENT_STATUSES = ['pending_payment', 'confirmed', 'checked_in', 'in_progress'];

/**
 * Terminal emergency statuses. Derived from the same vocabulary the queue uses rather than
 * retyped — a status invented here would silently make the count too high or too low.
 */
const TERMINAL_EMERGENCY_STATUSES = ['resolved', 'cancelled', 'false_alarm'];

/** A ticket is outstanding until it is resolved or closed. */
const OPEN_TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'waiting_requester'];

export class MetricsRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Appointment counts.
   *
   * THE JOIN IS NOT OPTIONAL. `appointments` stores no `starts_at`, because the instants live
   * on the slot and are projected through this join everywhere else in the API. Counting a
   * time window therefore has to reach the slot, and doing otherwise would not compile against
   * the real schema.
   */
  async appointments(organizationId: string): Promise<AppointmentMetrics> {
    const result = await this.database.query<{ total: string; within: string; active: string }>(
      `SELECT count(*)::text AS total,
              count(*) FILTER (
                WHERE slot.starts_at >= now() AND slot.starts_at < now() + interval '24 hours'
              )::text AS within,
              count(*) FILTER (
                WHERE appointment.status = ANY($2::appointment_status[])
              )::text AS active
       FROM appointments appointment
       JOIN appointment_slots slot ON slot.slot_id = appointment.slot_id
       WHERE appointment.organization_id = $1`,
      [organizationId, ACTIVE_APPOINTMENT_STATUSES],
    );
    const row = result.rows[0];
    return {
      total: Number(row?.total ?? 0),
      startingWithin24h: Number(row?.within ?? 0),
      active: Number(row?.active ?? 0),
    };
  }

  async emergencies(organizationId: string): Promise<EmergencyMetrics> {
    const result = await this.database.query<{ active: string }>(
      `SELECT count(*)::text AS active FROM emergency_events
       WHERE organization_id = $1 AND status <> ALL($2::emergency_event_status[])`,
      [organizationId, TERMINAL_EMERGENCY_STATUSES],
    );
    return { active: Number(result.rows[0]?.active ?? 0) };
  }

  /**
   * Support counts, including how many are past their resolution deadline.
   *
   * The breach count is derived from `resolution_due_at` against the clock rather than from a
   * stored flag, so it cannot drift out of date the way a cached boolean would.
   */
  async support(organizationId: string): Promise<SupportMetrics> {
    const result = await this.database.query<{ open: string; breaching: string }>(
      `SELECT count(*)::text AS open,
              count(*) FILTER (WHERE resolution_due_at < now())::text AS breaching
       FROM support_tickets
       WHERE organization_id = $1 AND status = ANY($2::support_ticket_status[])`,
      [organizationId, OPEN_TICKET_STATUSES],
    );
    const row = result.rows[0];
    return { open: Number(row?.open ?? 0), breachingResolution: Number(row?.breaching ?? 0) };
  }

  /**
   * Doctors listed in the directory.
   *
   * The predicate matches the directory's own — active membership, approved verification — so
   * this count and that list can never disagree. A doctor awaiting approval is excluded from
   * both.
   */
  async doctors(organizationId: string): Promise<DoctorMetrics> {
    const result = await this.database.query<{ listed: string; accepting: string }>(
      `SELECT count(*)::text AS listed,
              count(*) FILTER (WHERE detail.accepts_new_patients)::text AS accepting
       FROM organization_memberships membership
       JOIN doctor_professional_details detail
         ON detail.membership_id = membership.membership_id
       WHERE membership.organization_id = $1
         AND membership.role_id = 'doctor'
         AND membership.status = 'active'
         AND membership.verification_status = 'approved'`,
      [organizationId],
    );
    const row = result.rows[0];
    return { listed: Number(row?.listed ?? 0), acceptingNewPatients: Number(row?.accepting ?? 0) };
  }

  /**
   * Captured consultation revenue for the current calendar month.
   *
   * Only `captured` payments count. A `pending` one is money that may never arrive and a
   * `refunded` one is money returned, so summing either into revenue would overstate it. The
   * payment table carries no organization, so the scope comes through the appointment — which
   * is also what keeps this from becoming a cross-organization total.
   */
  async revenue(organizationId: string): Promise<RevenueMetrics> {
    const result = await this.database.query<{ captured: string; period: Date }>(
      `SELECT coalesce(sum(payment.amount_sen), 0)::text AS captured,
              date_trunc('month', now()) AS period
       FROM appointment_payments payment
       JOIN appointments appointment ON appointment.appointment_id = payment.appointment_id
       WHERE appointment.organization_id = $1
         AND payment.state = 'captured'
         AND payment.created_at >= date_trunc('month', now())`,
      [organizationId],
    );
    const row = result.rows[0];
    return {
      capturedSen: Number(row?.captured ?? 0),
      currency: 'MYR',
      periodStart: row?.period ?? new Date(),
    };
  }
}
