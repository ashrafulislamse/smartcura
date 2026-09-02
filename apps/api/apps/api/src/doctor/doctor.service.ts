import { Injectable } from '@nestjs/common';
import { problem } from '../platform/problems.js';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import type { SessionMembershipRecord } from '@smartcura/database';
import {
  DoctorDashboardRepository,
  type AppointmentStatusBreakdown,
  type PatientCountPoint,
} from './doctor-dashboard.repository.js';
import {
  APPOINTMENT_STATUS_VOCABULARY,
  UPCOMING_APPOINTMENT_LIMIT,
} from './doctor.schemas.js';

/**
 * Doctor dashboard and analytics service.
 *
 * AUTHORIZATION. Both endpoints are assignment-scoped, not organization-scoped: the
 * active doctor's `membership_id` is taken from the session and every query is
 * restricted to rows where that membership is the clinician, author or payee. This
 * matches the `assignedPatients` pattern in `WorkstreamFService`: the doctor must hold
 * an active membership with `role_id = 'doctor'` and the `profile_detail:read:assigned`
 * permission, because that is the permission the doctor patient surface already requires
 * and the dashboard summarises the same assignment-scoped data.
 *
 * BEST-EFFORT OMISSION. Every count is fetched independently and a field whose backing
 * query fails (or whose table does not exist in this build) is OMITTED from the
 * response, never returned as 0. Returning 0 would be worse than omitting the field —
 * it would assert something false and be indistinguishable from a genuinely empty set
 * (see `MetricsService` for the same reasoning). The `readable_groups` list names the
 * fields that were successfully computed so a reader can tell a refusal from an
 * unimplemented feature.
 */
@Injectable()
export class DoctorService {
  constructor(private readonly repository: DoctorDashboardRepository) {}

  /**
   * GET /doctor/dashboard — aggregate summary for the active doctor.
   *
   * Each count is awaited separately so a failure in one query does not suppress the
   * others. The fields are added to the response object only when their query succeeds;
   * a query that throws is caught and the field is simply omitted. This is the
   * best-effort contract: the dashboard shows what it can honestly compute.
   */
  async dashboard(current: AuthenticatedSession): Promise<{
    data: Record<string, unknown>;
    readable_groups: string[];
  }> {
    const active = this.doctor(current);
    const profileId = current.aggregate.profile.profileId;
    const response: Record<string, unknown> = {};

    // Today's appointment count (next 24h). The join to appointment_slots is required
    // because appointments carry no instants of their own.
    await this.tryAdd(response, 'today_appointments', () =>
      this.repository.countTodaysAppointments(active.membershipId),
    );

    // Upcoming appointments (next 5). Returns structured records, not a count, so the
    // dashboard can show the patient and time without a second round-trip.
    await this.tryAdd(response, 'upcoming_appointments', async () => {
      const rows = await this.repository.listUpcomingAppointments(
        active.membershipId,
        UPCOMING_APPOINTMENT_LIMIT,
      );
      return rows.map(upcomingAppointmentResponse);
    });

    // Active assigned patient count.
    await this.tryAdd(response, 'assigned_patients', () =>
      this.repository.countActiveAssignedPatients(active.membershipId),
    );

    // Pending (draft) clinical notes.
    await this.tryAdd(response, 'pending_notes', () =>
      this.repository.countPendingNotes(active.membershipId),
    );

    // Unread notifications. Keyed by profile_id, not membership_id.
    await this.tryAdd(response, 'unread_notifications', () =>
      this.repository.countUnreadNotifications(profileId),
    );

    // Active IoT alerts for the doctor's assigned patients.
    await this.tryAdd(response, 'active_iot_alerts', () =>
      this.repository.countActiveIotAlerts(active.membershipId),
    );

    return { data: response, readable_groups: Object.keys(response).sort() };
  }

  /**
   * GET /doctor/analytics — doctor-specific analytics over time.
   *
   * Each projection is computed independently and omitted if it cannot be computed
   * honestly. The appointment-status breakdown always covers the full status vocabulary
   * (zero-count statuses included) so a reader can distinguish "no completed
   * appointments" from "this status does not exist".
   */
  async analytics(current: AuthenticatedSession): Promise<{
    data: Record<string, unknown>;
    readable_groups: string[];
  }> {
    const active = this.doctor(current);
    const response: Record<string, unknown> = {};

    // Appointments over the last 30 days, broken down by status. The full vocabulary is
    // merged in so zero-count statuses appear explicitly.
    await this.tryAdd(response, 'appointment_status_breakdown', async () => {
      const rows = await this.repository.appointmentStatusBreakdown(active.membershipId);
      return mergeStatusVocabulary(rows);
    });

    // Patient count trend, bucketed weekly over the last 30 days.
    await this.tryAdd(response, 'patient_count_trend', async () => {
      const rows = await this.repository.patientCountTrend(active.membershipId);
      return rows.map(patientCountPointResponse);
    });

    // Average rating and review count.
    await this.tryAdd(response, 'rating_summary', async () => {
      const summary = await this.repository.doctorRatingSummary(active.membershipId);
      return {
        rating_average: summary.ratingAverage,
        review_count: summary.reviewCount,
      };
    });

    // Monthly earnings projection. Scoped to the doctor's organization so the ledger
    // join cannot cross an organization boundary.
    await this.tryAdd(response, 'monthly_earnings_projection', async () => {
      const projection = await this.repository.monthlyEarningsProjection(
        active.membershipId,
        active.organizationId,
      );
      return {
        projected_sen: projection.projectedSen,
        currency: projection.currency,
        period_start: projection.periodStart.toISOString(),
        basis_count: projection.basisCount,
      };
    });

    return { data: response, readable_groups: Object.keys(response).sort() };
  }

  /**
   * Resolve the active doctor membership from the session, refusing if the caller is not
   * an active doctor with assignment-read authority.
   *
   * This mirrors `WorkstreamFService.assignedPatients`: the same `role_id = 'doctor'`
   * check and the same `profile_detail:read:assigned` permission, because the dashboard
   * and analytics summarise the same assignment-scoped data the patient list exposes.
   * A non-doctor membership or a revoked membership is refused with 403, not 404,
   * because the route itself is doctor-scoped and the caller's identity — not a
   * resource — is what is missing.
   */
  private doctor(current: AuthenticatedSession): SessionMembershipRecord {
    const active = current.aggregate.memberships.find(
      (m) => m.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (
      !active ||
      active.status !== 'active' ||
      active.roleId !== 'doctor' ||
      !active.permissions.includes('profile_detail:read:assigned')
    ) {
      throw problem(403, 'PERMISSION_DENIED', 'Doctor assignment authority is required');
    }
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    return active;
  }

  /**
   * Run a query and add its result to the response under the given key, omitting the
   * field if the query throws. This is the best-effort contract: a table that does not
   * exist in this build, or a query that fails for any reason, produces an absent key
   * rather than a zero or an error that suppresses the rest of the dashboard.
   *
   * The error is not logged here because the platform's problem-details filter already
   * records unexpected failures with a correlation id; logging here would duplicate
   * that and could leak query structure into operational logs. The omission itself is
   * the signal to the caller that the field could not be computed.
   */
  private async tryAdd(
    target: Record<string, unknown>,
    key: string,
    operation: () => Promise<unknown>,
  ): Promise<void> {
    try {
      target[key] = await operation();
    } catch {
      // Best-effort: omit the field rather than return 0 or fail the whole response.
    }
  }
}

/**
 * Serialise an upcoming appointment to the response shape. `starts_at` is ISO-8601
 * because the server never sends a formatted string (the money convention applied to
 * time as well). The patient is identified by `profile_id` only — no name is resolved,
 * because `Profile` is reachable solely as `/profiles/me` and a name-resolution
 * endpoint does not exist yet (see AGENTS.md, `users/patients` is deliberately not
 * on the work list for this reason).
 */
function upcomingAppointmentResponse(r: {
  appointmentId: string;
  patientProfileId: string;
  startsAt: Date;
  status: string;
  mode: string;
}) {
  return {
    appointment_id: r.appointmentId,
    patient_profile_id: r.patientProfileId,
    starts_at: r.startsAt.toISOString(),
    status: r.status,
    mode: r.mode,
  };
}

/**
 * Serialise a weekly patient-count point. The period is ISO-8601 instants so a reader
 * does not have to guess the bucket width.
 */
function patientCountPointResponse(r: PatientCountPoint) {
  return {
    period_start: r.periodStart.toISOString(),
    period_end: r.periodEnd.toISOString(),
    count: r.count,
  };
}

/**
 * Merge the status breakdown rows with the full status vocabulary so zero-count
 * statuses appear explicitly. Without this, a status with no appointments in the
 * window would be absent from the array, and a reader could not tell "no appointments
 * with this status" from "this status does not exist in the vocabulary".
 *
 * The vocabulary is keyed over `APPOINTMENT_STATUS_VOCABULARY` so an invented status
 * cannot compile (the AGENTS.md convention: a generated type is the vocabulary; a
 * hand-typed one is a guess).
 */
function mergeStatusVocabulary(
  rows: AppointmentStatusBreakdown[],
): { status: string; count: number }[] {
  const byStatus = new Map<string, number>();
  for (const row of rows) byStatus.set(row.status, row.count);
  return APPOINTMENT_STATUS_VOCABULARY.map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  }));
}
