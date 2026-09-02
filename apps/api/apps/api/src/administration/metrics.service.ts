import { Injectable } from '@nestjs/common';
import { MetricsRepository } from '@smartcura/database';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';

/**
 * Dashboard metrics.
 *
 * THE DESIGN DECISION THAT MATTERS HERE IS OMISSION RATHER THAN ZERO. An aggregate endpoint is
 * a way to learn how many records exist in a set you may not be allowed to enumerate, so each
 * group is gated on the SAME permission as the collection it summarises, and a group the caller
 * cannot read is left OUT of the response entirely.
 *
 * Returning `0` instead would be worse than returning nothing, twice over: it would leak that
 * the group exists while asserting something false about it, and it would be indistinguishable
 * from a genuinely empty organization. A reader can act on an absent key; they cannot act on a
 * zero that might mean "none" or might mean "not for you".
 *
 * The permission for each group is the one the corresponding list route already requires, so a
 * caller can never learn a count here that they could not have obtained by paging the
 * collection itself. This endpoint is a convenience, never an escalation.
 */
@Injectable()
export class MetricsService {
  constructor(private readonly metrics: MetricsRepository) {}

  async readDashboard(current: AuthenticatedSession) {
    const active = this.active(current);
    const held = (permission: string) => active.permissions.includes(permission);

    /*
      Each branch is awaited only when permitted, so the SQL for a forbidden group never runs.
      That is deliberately stronger than computing everything and stripping the response: no
      query is issued against data the caller has no authority over, which also means a
      forbidden group cannot show up in a slow-query log as something this caller asked for.
    */
    const response: Record<string, unknown> = {};

    if (held('appointment:read:organization')) {
      const appointments = await this.metrics.appointments(active.organizationId);
      response.appointments = {
        total: appointments.total,
        starting_within_24h: appointments.startingWithin24h,
        active: appointments.active,
      };
    }

    if (held('emergency.event:read:site')) {
      const emergencies = await this.metrics.emergencies(active.organizationId);
      response.emergencies = { active: emergencies.active };
    }

    if (held('support.ticket:manage:organization')) {
      const support = await this.metrics.support(active.organizationId);
      response.support = {
        open: support.open,
        breaching_resolution: support.breachingResolution,
      };
    }

    if (held('doctor_detail:read:global')) {
      const doctors = await this.metrics.doctors(active.organizationId);
      response.doctors = {
        listed: doctors.listed,
        accepting_new_patients: doctors.acceptingNewPatients,
      };
    }

    if (held('ledger:read:organization')) {
      const revenue = await this.metrics.revenue(active.organizationId);
      response.revenue = {
        captured_sen: revenue.capturedSen,
        currency: revenue.currency,
        period_start: revenue.periodStart.toISOString(),
      };
    }

    /*
      The groups the caller may read are named explicitly. Without this a reader cannot tell an
      omitted group from one this build does not implement yet, and the page would have to guess
      whether a missing key means "refused" or "not a feature". Naming them makes the refusal
      legible without disclosing anything about the data behind it.
    */
    return { data: response, readable_groups: Object.keys(response).sort() };
  }

  /**
   * The same active-membership resolution the rest of the administration surface uses, rather
   * than a second implementation of it: the session names an active membership id and the
   * aggregate carries the memberships, so the two must be matched up. An inactive membership
   * or an incomplete onboarding is refused here for the same reasons it is refused elsewhere.
   */
  private active(current: AuthenticatedSession) {
    const active = current.aggregate.memberships.find(
      (entry) => entry.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (
      current.aggregate.profile.status !== 'active' ||
      current.aggregate.profile.onboardingCompletedAt === null
    ) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    return active;
  }
}
