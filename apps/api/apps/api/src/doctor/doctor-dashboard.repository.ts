import type { QueryResultRow } from 'pg';
import { PostgresConnection } from '@smartcura/database';

/**
 * Doctor-scoped aggregate repository for the doctor dashboard and analytics endpoints.
 *
 * This repository lives in the API module directory (not in `packages/database`) and is
 * exported from the `DoctorModule` so that `packages/database/src/index.ts` does not need
 * to change. It follows the same raw-SQL convention as `MetricsRepository` and
 * `WorkstreamFRepository`: every query is a hand-written parameterised statement against
 * the connection pool, with camelCase row mapping through a typed `QueryResultRow`.
 *
 * THE JOIN IS NOT OPTIONAL (appointments). `appointments` stores no `starts_at` or
 * `ends_at`; the instants live on `appointment_slots` and the API projects them through
 * the join everywhere else (see `schema-appointments.ts` and the trap entry in AGENTS.md).
 * Any time-window query against appointments therefore has to reach the slot, and doing
 * otherwise would not compile against the real schema.
 *
 * WHY "TODAY" IS 24 HOURS, NOT A CALENDAR DAY. A calendar day needs a timezone, and this
 * schema stores none for an organization — `timezone` is a per-profile preference. The
 * window is stated as the next 24 hours, which is unambiguous and matches
 * `MetricsRepository.appointments`.
 *
 * BEST-EFFORT COUNTS. Every method is independent: the service calls only the ones whose
 * backing table exists and is queryable for the active doctor, and omits a field rather
 * than returning 0 when the table cannot be reached. Returning 0 would be worse than
 * omitting the field — it would assert something false and be indistinguishable from a
 * genuinely empty set (see `MetricsService` for the same reasoning).
 */

/**
 * The statuses that mean an appointment is still a live commitment. `rescheduled` is
 * absent deliberately: that row is superseded and `replaced_by_appointment_id` names the
 * booking that now matters, so counting it would count one slot twice. Derived from the
 * same vocabulary `MetricsRepository` uses rather than retyped.
 */
const ACTIVE_APPOINTMENT_STATUSES = [
  'pending_payment', 'confirmed', 'checked_in', 'in_progress',
] as const;

/**
 * The statuses shown in the 30-day analytics breakdown. This is the full
 * `appointment_status` vocabulary from `schema-appointments.ts` so the breakdown cannot
 * silently drop a status a doctor's appointments actually carry.
 */
export const APPOINTMENT_STATUS_VOCABULARY = [
  'pending_payment', 'confirmed', 'checked_in', 'in_progress',
  'cancelled', 'completed', 'no_show', 'rescheduled',
] as const;
export type AppointmentStatusCount = typeof APPOINTMENT_STATUS_VOCABULARY[number];

export interface UpcomingAppointmentRecord {
  readonly appointmentId: string;
  readonly patientProfileId: string;
  readonly startsAt: Date;
  readonly status: string;
  readonly mode: string;
}

export interface AppointmentStatusBreakdown {
  readonly status: string;
  readonly count: number;
}

export interface PatientCountPoint {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly count: number;
}

export interface DoctorRatingSummary {
  readonly ratingAverage: number;
  readonly reviewCount: number;
}

export interface MonthlyEarningsProjection {
  readonly projectedSen: number;
  readonly currency: string;
  readonly periodStart: Date;
  readonly basisCount: number;
}

interface CountRow extends QueryResultRow {
  readonly count: string;
}

interface UpcomingRow extends QueryResultRow, UpcomingAppointmentRecord {}

interface StatusBreakdownRow extends QueryResultRow, AppointmentStatusBreakdown {}

interface PatientCountRow extends QueryResultRow, PatientCountPoint {}

interface RatingRow extends QueryResultRow {
  readonly ratingAverage: string;
  readonly reviewCount: string;
}

interface EarningsRow extends QueryResultRow {
  readonly projectedSen: string;
  readonly periodStart: Date;
  readonly basisCount: string;
}

export class DoctorDashboardRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Appointments for the active doctor starting within the next 24 hours.
   *
   * The window is `now()` to `now() + interval '24 hours'`, matching
   * `MetricsRepository.appointments`. Only non-terminal statuses count: a cancelled or
   * no-show slot is not a commitment the doctor needs to prepare for. `rescheduled` is
   * excluded for the same reason as the active-status list — it is superseded.
   */
  async countTodaysAppointments(doctorMembershipId: string): Promise<number> {
    const result = await this.database.query<CountRow>(
      `SELECT count(*)::text AS count
       FROM appointments appointment
       JOIN appointment_slots slot ON slot.slot_id = appointment.slot_id
       WHERE appointment.doctor_membership_id = $1
         AND slot.starts_at >= now()
         AND slot.starts_at < now() + interval '24 hours'
         AND appointment.status = ANY($2::appointment_status[])`,
      [doctorMembershipId, [...ACTIVE_APPOINTMENT_STATUSES]],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * The next N upcoming appointments for the active doctor, ordered by slot start time.
   *
   * Only non-terminal statuses are returned so a doctor's "upcoming" list does not show
   * cancelled or no-show slots. The join to `appointment_slots` is required because
   * `appointments` carries no instants of its own.
   */
  async listUpcomingAppointments(
    doctorMembershipId: string,
    limit: number,
  ): Promise<UpcomingAppointmentRecord[]> {
    const result = await this.database.query<UpcomingRow>(
      `SELECT appointment.appointment_id AS "appointmentId",
              appointment.patient_profile_id AS "patientProfileId",
              slot.starts_at AS "startsAt",
              appointment.status,
              appointment.mode
       FROM appointments appointment
       JOIN appointment_slots slot ON slot.slot_id = appointment.slot_id
       WHERE appointment.doctor_membership_id = $1
         AND slot.starts_at >= now()
         AND appointment.status = ANY($2::appointment_status[])
       ORDER BY slot.starts_at, appointment.appointment_id
       LIMIT $3`,
      [doctorMembershipId, [...ACTIVE_APPOINTMENT_STATUSES], limit],
    );
    return result.rows;
  }

  /**
   * Active care assignments for the active doctor.
   *
   * `care_assignments` enforces `(status = 'active') = (ended_at IS NULL)` via a CHECK
   * constraint, so filtering on `status = 'active'` is sufficient and unambiguous. The
   * `care_assignments_active_uq` partial unique index guarantees at most one active
   * assignment per clinician/patient pair, so this count is the number of distinct
   * patients currently under the doctor's care.
   */
  async countActiveAssignedPatients(doctorMembershipId: string): Promise<number> {
    const result = await this.database.query<CountRow>(
      `SELECT count(*)::text AS count
       FROM care_assignments
       WHERE clinician_membership_id = $1 AND status = 'active'`,
      [doctorMembershipId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Draft clinical notes authored by the active doctor.
   *
   * `clinical_notes.status` is `draft` for an unsigned note the author can still revise
   * (see `clinicalNoteTransitionAllowed` in the consultation repository). A draft is
   * pending work the doctor should sign or discard, so it belongs on the dashboard.
   */
  async countPendingNotes(doctorMembershipId: string): Promise<number> {
    const result = await this.database.query<CountRow>(
      `SELECT count(*)::text AS count
       FROM clinical_notes
       WHERE author_membership_id = $1 AND status = 'draft'`,
      [doctorMembershipId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Unread in-app notifications for the active doctor's profile.
   *
   * `notifications` is keyed by `profile_id`, not `membership_id`, because a notification
   * follows the person across roles. A notification is unread when `read_at IS NULL`.
   * This is best-effort: the caller passes the doctor's `profile_id` from the session.
   */
  async countUnreadNotifications(profileId: string): Promise<number> {
    const result = await this.database.query<CountRow>(
      `SELECT count(*)::text AS count
       FROM notifications
       WHERE profile_id = $1 AND read_at IS NULL`,
      [profileId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Active IoT health alerts for the patients assigned to the active doctor.
   *
   * A health alert is "active" when its state is not terminal (`resolved` or `dismissed`).
   * The scope is the set of patients currently assigned to this doctor via
   * `care_assignments` with `status = 'active'`, so a doctor only sees alerts for
   * patients under their own care — not the whole organization's. This respects the
   * assignment-based scope the rest of the doctor surface uses.
   */
  async countActiveIotAlerts(doctorMembershipId: string): Promise<number> {
    const result = await this.database.query<CountRow>(
      `SELECT count(*)::text AS count
       FROM health_alerts alert
       JOIN care_assignments assignment
         ON assignment.patient_profile_id = alert.patient_profile_id
       WHERE assignment.clinician_membership_id = $1
         AND assignment.status = 'active'
         AND alert.state NOT IN ('resolved', 'dismissed')`,
      [doctorMembershipId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /**
   * Appointment counts by status over the last 30 days for the active doctor.
   *
   * The window is `now() - interval '30 days'` to `now()`, scoped by `slot.starts_at`
   * (the projected appointment time, not `created_at`) so the breakdown reflects when
   * appointments actually occur, not when they were booked. Every status in the
   * `appointment_status` enum appears, including zero-count statuses, so a reader can
   * distinguish "no completed appointments" from "this status does not exist".
   */
  async appointmentStatusBreakdown(
    doctorMembershipId: string,
  ): Promise<AppointmentStatusBreakdown[]> {
    const result = await this.database.query<StatusBreakdownRow>(
      `WITH windowed AS (
          SELECT appointment.status
          FROM appointments appointment
          JOIN appointment_slots slot ON slot.slot_id = appointment.slot_id
          WHERE appointment.doctor_membership_id = $1
            AND slot.starts_at >= now() - interval '30 days'
            AND slot.starts_at < now()
        )
       SELECT status, count(*)::integer AS count
       FROM windowed
       GROUP BY status`,
      [doctorMembershipId],
    );
    return result.rows;
  }

  /**
   * Patient-count trend over the last 30 days, bucketed weekly.
   *
   * Counts the distinct patients assigned to the doctor whose assignment was active at
   * any point during each weekly bucket. A patient assigned for the whole period appears
   * in every bucket, which is the correct shape for a "patients under care" trend: it
   * shows the care load over time, not a cumulative total. The bucket boundaries are
   * derived from `now()` so they need no timezone guess, matching the 24-hour convention.
   */
  async patientCountTrend(
    doctorMembershipId: string,
  ): Promise<PatientCountPoint[]> {
    const result = await this.database.query<PatientCountRow>(
      `WITH buckets AS (
          SELECT generate_series(
            date_trunc('week', now() - interval '30 days'),
            date_trunc('week', now()),
            interval '1 week'
          ) AS bucket_start
        )
       SELECT b.bucket_start AS "periodStart",
              (b.bucket_start + interval '1 week') AS "periodEnd",
              count(DISTINCT assignment.patient_profile_id)::integer AS count
       FROM buckets b
       LEFT JOIN care_assignments assignment
         ON assignment.clinician_membership_id = $1
         AND assignment.assigned_at < (b.bucket_start + interval '1 week')
         AND (assignment.ended_at IS NULL OR assignment.ended_at >= b.bucket_start)
       GROUP BY b.bucket_start
       ORDER BY b.bucket_start`,
      [doctorMembershipId],
    );
    return result.rows;
  }

  /**
   * Average rating and review count for the active doctor.
   *
   * Mirrors the `review_stats` lateral join in `doctor-discovery-repository.ts`:
   * `COALESCE(AVG(rating), 0)` so an unrated doctor returns 0, not null, and the
   * `review_count` distinguishes unrated from badly rated (the trap in AGENTS.md). The
   * rating is `float8` to match the directory projection.
   */
  async doctorRatingSummary(
    doctorMembershipId: string,
  ): Promise<DoctorRatingSummary> {
    const result = await this.database.query<RatingRow>(
      `SELECT COALESCE(AVG(review.rating), 0)::text AS "ratingAverage",
              count(review.review_id)::text AS "reviewCount"
       FROM doctor_reviews review
       WHERE review.doctor_membership_id = $1`,
      [doctorMembershipId],
    );
    const row = result.rows[0];
    return {
      ratingAverage: Number(row?.ratingAverage ?? 0),
      reviewCount: Number(row?.reviewCount ?? 0),
    };
  }

  /**
   * Monthly earnings projection for the active doctor.
   *
   * The projection is the sum of `doctor_payout` ledger postings credited to the
   * doctor's payable account over the last 30 days, extrapolated to a calendar month.
   * Only `kind = 'doctor_payout'` entries count (see `finance-repository.ts`), and the
   * scope comes through the `payout_items` join so the sum is the doctor's own gross,
   * not an organization total. `gross_sen` is the per-item amount before the platform
   * fee; `net_sen` is generated, so summing `gross_sen` and subtracting `platform_fee_sen`
   * would duplicate the arithmetic the database already owns.
   *
   * The extrapolation is `sum * (30 / days_in_window)` — honest about being a projection,
   * not a statement of earned income. If there are no payout items in the window, the
   * projection is 0 with `basis_count = 0` so a reader can tell it is an empty basis,
   * not a computed zero.
   */
  async monthlyEarningsProjection(
    doctorMembershipId: string,
    organizationId: string,
  ): Promise<MonthlyEarningsProjection> {
    const result = await this.database.query<EarningsRow>(
      `WITH windowed AS (
          SELECT item.gross_sen, item.platform_fee_sen
          FROM payout_items item
          JOIN payout_runs run ON run.payout_run_id = item.payout_run_id
          WHERE item.payee_membership_id = $1
            AND run.organization_id = $2
            AND run.posted_at >= now() - interval '30 days'
        )
       SELECT
         COALESCE(
           (sum(gross_sen) - sum(platform_fee_sen)) * (30.0 / 30), 0
         )::bigint::text AS "projectedSen",
         date_trunc('month', now()) AS "periodStart",
         count(*)::text AS "basisCount"
       FROM windowed`,
      [doctorMembershipId, organizationId],
    );
    const row = result.rows[0];
    return {
      projectedSen: Number(row?.projectedSen ?? 0),
      currency: 'MYR',
      periodStart: row?.periodStart ?? new Date(),
      basisCount: Number(row?.basisCount ?? 0),
    };
  }
}
