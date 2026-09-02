import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession,
  type AuthenticatedSession,
  RequireCsrf,
  RequirePermission,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { ReadingsService } from './readings.service.js';

/**
 * Reading ingestion, addressed by DEVICE inside its organization.
 *
 * The device is in the path and the patient is not, anywhere. Attribution is
 * resolved server side from the device's open assignment, so a client cannot name
 * the patient a reading belongs to — the same rule the MQTT vitals packet follows,
 * where `patient_id` is forbidden by contract.
 *
 * No `@RequirePermission`. `reading:ingest:device` ends in a scope suffix the
 * policy engine does not parse, so `evaluatePermission` — which is all the shared
 * guard can call — answers `invalid_permission` and would deny every caller. The
 * service proves the grant by explicit membership of the acting role's granted
 * list, which is the same set `role_permissions` holds and the repository re-checks
 * by `permission_id` under lock. Migration 0014 and HANDOFF-0014.md record the
 * `PermissionScope` extension that will let the guard decide this route.
 *
 * There is deliberately no `Idempotency-Key` on this route: each reading carries
 * its own packet identity and `vital_reading_ingest_claims` is the dedupe
 * authority, so a header would add a second, weaker mechanism that keys on whole
 * requests instead of on packets.
 */
@AuthenticatedOnly()
@Controller('organizations/:organizationId/devices/:deviceId/vital-readings')
export class DeviceVitalReadingsController {
  constructor(private readonly readings: ReadingsService) {}

  /**
   * Submits a batch of readings. 202 Accepted rather than 201: the response
   * classifies the batch — accepted, deduplicated, rejected, alerts raised — and a
   * routine batch is a mixture of all of them, so there is no single created
   * resource to name. Thresholds are evaluated in the same transaction as the
   * insert, so an alert exists if and only if the reading that raised it does.
   */
  @Post()
  @HttpCode(202)
  @RequireCsrf('reading.ingest')
  async ingest(
    @CurrentSession() current: AuthenticatedSession,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.readings.ingest(current, organizationId, deviceId, body);
  }
}

/**
 * The authenticated patient's own reading history.
 *
 * `@RequirePermission('reading:read:own', ...)` is present because this is the one
 * route on the IoT surface whose requirement is both static and decidable from the
 * session alone: the owner is the actor, so the shared guard's owner-only object
 * policy context is exactly what an `own` scope needs, and a caller without the
 * grant is rejected before any query runs.
 *
 * The route has no patient parameter, and the service takes the profile from the
 * session. That is the point: an identifier in a path or query is the one value a
 * caller can always change, so there is nothing here to change.
 */
@AuthenticatedOnly()
@Controller('profiles/me')
export class OwnVitalReadingsController {
  constructor(private readonly readings: ReadingsService) {}

  @Get('vital-readings')
  @RequirePermission('reading:read:own', 'reading.read.own')
  async listOwn(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.readings.listOwnReadings(current, query);
  }

}

/**
 * A patient's readings and alerts for the clinician actively assigned to them.
 *
 * Neither route carries `@RequirePermission`. Both requirements are `assigned`
 * scoped, and `assigned` is satisfied only by a row in `care_assignments`;
 * `PermissionGuard` evaluates object policy with owner context alone and never
 * supplies `assigned`, so a guard requirement would deny every caller. The service
 * looks the assignment up first, feeds the answer into the policy decision, denies
 * by default and audits every refusal — the same division of labour
 * `VerificationController` uses for a requirement that depends on the
 * caller-to-target relationship.
 *
 * A caller with no active assignment to the addressed patient receives 404, not
 * 403: whether a given person is a patient of this organization is itself
 * sensitive, and a 403 would confirm it to anyone able to guess a profile
 * identifier. Absence and refusal are indistinguishable by design, and the real
 * reason is recorded in the audit log.
 *
 * `admin` reaches neither route. Migration 0014 grants it device administration
 * and ingestion but no clinical read scope at all, because an administrator has no
 * care relationship with a patient.
 */
@AuthenticatedOnly()
@Controller('patients/:patientProfileId')
export class PatientVitalReadingsController {
  constructor(private readonly readings: ReadingsService) {}

  /**
   * The patient's reading history, newest first, optionally narrowed to one metric
   * and a time window. Pagination is deterministic on `(recorded_at, reading_id)`;
   * a bounded window also lets the database prune reading partitions.
   */
  @Get('vital-readings')
  async listReadings(
    @CurrentSession() current: AuthenticatedSession,
    @Param('patientProfileId') patientProfileId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.readings.listPatientReadings(current, patientProfileId, query);
  }

  /**
   * Health alerts raised for the patient, newest first, optionally narrowed to one
   * state. At most one alert is live per patient, metric and threshold, so a
   * sustained breach appears once rather than once per reading.
   */
  @Get('health-alerts')
  async listAlerts(
    @CurrentSession() current: AuthenticatedSession,
    @Param('patientProfileId') patientProfileId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.readings.listPatientAlerts(current, patientProfileId, query);
  }
}

/**
 * Alert acknowledgement, addressed by ALERT.
 *
 * The alert is addressed directly because it is what changes and because its
 * organization and patient are properties of the alert, not of the URL — putting
 * either in the path would invite a caller to supply one that disagrees with the
 * stored row. The service reads the alert to learn both, proves the care
 * assignment, and conceals every mismatch as 404.
 *
 * No `@RequirePermission`, for the same reason as the assigned reads:
 * `alert:acknowledge:assigned` needs a care assignment the shared guard cannot see.
 * No `Idempotency-Key` either — `expected_version` already makes a repeated
 * acknowledgement a version conflict rather than a second clinical act, and the
 * repository returns an already-acknowledged alert unchanged instead of failing.
 */
@AuthenticatedOnly()
@Controller('health-alerts')
export class HealthAlertsController {
  constructor(private readonly readings: ReadingsService) {}

  @Post(':alertId/acknowledge')
  @HttpCode(200)
  @RequireCsrf('health_alert.acknowledge')
  async acknowledge(
    @CurrentSession() current: AuthenticatedSession,
    @Param('alertId') alertId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.readings.acknowledgeAlert(current, alertId, body);
  }

  @Put(':alertId/state')
  @RequireCsrf('health_alert.transition')
  async transition(
    @CurrentSession() current: AuthenticatedSession,
    @Param('alertId') alertId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.readings.transitionAlert(current, alertId, body);
  }
}

/**
 * Rejects a body whose media type was not declared as JSON. Nest would otherwise
 * hand the handler an empty object for an unparsed body, which a `.strict()`
 * schema turns into a confusing VALIDATION_FAILED instead of the accurate 415.
 */
function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON content type is required');
  }
}
