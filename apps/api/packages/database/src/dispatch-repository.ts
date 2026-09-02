import type { PoolClient, QueryResultRow } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { PostgresConnection } from './connection.js';
import { postBalancedEntry } from './ledger-posting.js';
import { createNotification } from './notification-repository.js';
import {
  DISPATCH_ASSIGNMENT_CHANGED_EVENT_TYPE,
  DISPATCH_ASSIGNMENT_CHANGED_EVENT_VERSION,
  DISPATCH_OFFER_EXPIRED_EVENT_TYPE,
  DISPATCH_OFFER_EXPIRED_EVENT_VERSION,
} from './dispatch-events.js';

export const DISPATCH_ASSIGNMENT_STATUSES = [
  'assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up',
  'en_route_dropoff', 'arrived_dropoff', 'completed', 'cancelled', 'failed',
] as const;
export type DispatchAssignmentStatus = typeof DISPATCH_ASSIGNMENT_STATUSES[number];
export type DispatchJobStatus =
  'pending' | 'offering' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | 'failed';
export type DispatchOfferStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

/** The happy path is strictly ordered; cancel/fail may interrupt any live step. */
const ASSIGNMENT_SEQUENCE: readonly DispatchAssignmentStatus[] = [
  'assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up',
  'en_route_dropoff', 'arrived_dropoff', 'completed',
];

export function assignmentTransitionAllowed(
  current: DispatchAssignmentStatus, next: DispatchAssignmentStatus,
): boolean {
  if (current === 'completed' || current === 'cancelled' || current === 'failed') return false;
  if (next === 'cancelled' || next === 'failed') return true;
  const from = ASSIGNMENT_SEQUENCE.indexOf(current);
  const to = ASSIGNMENT_SEQUENCE.indexOf(next);
  // Exactly one step forward. Skipping `picked_up` would let a delivery complete
  // without the driver ever collecting the medication.
  return from >= 0 && to === from + 1;
}


/**
 * The catalogue withdrawal lifecycle. `failed` is distinct from `rejected` on purpose: a bank
 * transfer that bounced is not an operator refusal, and conflating them would hide which of the
 * two happened to a driver's money.
 */
const WITHDRAWAL_NEXT: Readonly<Record<string, readonly string[]>> = Object.freeze({
  requested: ['under_review', 'rejected', 'cancelled'],
  under_review: ['approved', 'rejected', 'cancelled'],
  // Cancellation stops here: once a transfer is in flight the driver can no longer withdraw the
  // request, because the money may already have left.
  approved: ['processing', 'rejected', 'cancelled'],
  processing: ['paid', 'failed'],
  paid: [],
  failed: [],
  rejected: [],
  cancelled: [],
});

export function withdrawalTransitionAllowed(current: string, next: string): boolean {
  return WITHDRAWAL_NEXT[current]?.includes(next) === true;
}
export function offerTransitionAllowed(
  current: DispatchOfferStatus, next: DispatchOfferStatus,
): boolean {
  return current === 'pending' && next !== 'pending';
}

/**
 * Minimum-necessary offer projection.
 *
 * A driver deciding whether to accept needs the fee, a coarse distance and an
 * expiry. They do NOT need the recipient's name, phone or address, so those fields
 * are not on the offer row at all and cannot appear here.
 */
export interface OfferSummary {
  readonly offerId: string;
  readonly dispatchJobId: string;
  readonly feeSen: number;
  readonly approxDistanceMetres: number | null;
  readonly expiresAt: Date;
  readonly version: number;
}
interface OfferSummaryRow extends QueryResultRow, OfferSummary {}

export function serializeOfferSummary(record: OfferSummary): Record<string, unknown> {
  return {
    offer_id: record.offerId,
    dispatch_job_id: record.dispatchJobId,
    fee_sen: record.feeSen,
    currency: 'MYR',
    approx_distance_metres: record.approxDistanceMetres,
    expires_at: record.expiresAt.toISOString(),
    version: record.version,
  };
}

/**
 * A driver's own assignment row, projected to the minimum a driver needs to track
 * their work: the job it belongs to, where it stands, when it started and ended, the
 * fee, and the optimistic-concurrency version. Recipient identity and address live on
 * the delivery record and are disclosed only through the active-assignment endpoint.
 */
export interface AssignmentSummary {
  readonly assignmentId: string;
  readonly dispatchJobId: string;
  readonly status: DispatchAssignmentStatus;
  readonly assignedAt: Date;
  readonly completedAt: Date | null;
  readonly feeSen: number;
  readonly version: number;
}
interface AssignmentSummaryRow extends QueryResultRow, AssignmentSummary {}

export function serializeAssignmentSummary(record: AssignmentSummary): Record<string, unknown> {
  return {
    assignment_id: record.assignmentId,
    dispatch_job_id: record.dispatchJobId,
    status: record.status,
    assigned_at: record.assignedAt.toISOString(),
    completed_at: record.completedAt === null ? null : record.completedAt.toISOString(),
    fee_sen: record.feeSen,
    version: record.version,
  };
}

/** The non-terminal statuses a driver is still actively working through. */
const ACTIVE_ASSIGNMENT_STATUSES: readonly DispatchAssignmentStatus[] = [
  'assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up',
  'en_route_dropoff', 'arrived_dropoff',
];

/** Disclosed only once an assignment is active. */
export interface RecipientDisclosure {
  readonly deliveryId: string;
  readonly recipientName: string;
  readonly recipientPhoneE164: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly postcode: string;
  readonly city: string;
  readonly stateCode: string;
}
interface RecipientRow extends QueryResultRow, RecipientDisclosure {}

/**
 * One planned stop of a dispatch job. Coordinates are the driver's navigation
 * target, disclosed only while the requesting driver holds an active assignment
 * for the job — the same rule as the recipient disclosure.
 */
export interface DispatchStop {
  readonly kind: 'pickup' | 'dropoff';
  readonly sequenceNo: number;
  readonly latitude: string;
  readonly longitude: string;
}
interface DispatchStopRow extends QueryResultRow, DispatchStop {}

export type DispatchFailure = 'not_found' | 'version_conflict' | 'invalid_transition' |
  'offer_expired' | 'offer_taken' | 'driver_busy' | 'not_assigned' | 'proof_required' |
  'vehicle_unknown' | 'throttled';

export interface VehicleRecord {
  readonly vehicleId: string;
  readonly plateNumber: string;
  readonly vehicleType: string;
  readonly active: boolean;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
interface VehicleRow extends QueryResultRow, VehicleRecord {}

export function serializeVehicle(record: VehicleRecord): Record<string, unknown> {
  return {
    vehicle_id: record.vehicleId,
    plate_number: record.plateNumber,
    vehicle_type: record.vehicleType,
    active: record.active,
    version: record.version,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}

export interface DeliveryRatingRecord {
  readonly ratingId: string;
  readonly deliveryId: string;
  readonly stars: number;
  readonly createdAt: Date;
}
interface DeliveryRatingRow extends QueryResultRow, DeliveryRatingRecord {}

export function serializeDeliveryRating(record: DeliveryRatingRecord): Record<string, unknown> {
  return {
    rating_id: record.ratingId,
    delivery_id: record.deliveryId,
    stars: record.stars,
    created_at: record.createdAt.toISOString(),
  };
}

/** Minimum seconds between accepted waypoints for one assignment. */
export const WAYPOINT_MIN_INTERVAL_SECONDS = 15;

/**
 * Decides whether a waypoint should be stored.
 *
 * High-frequency location data has short retention and real cost, so ordinary
 * points are throttled. A `significant` point — a status change or a large
 * deviation — is always kept, because route audit depends on it.
 */
export function waypointAccepted(input: {
  readonly lastRecordedAt: Date | null;
  readonly recordedAt: Date;
  readonly significant: boolean;
}): boolean {
  if (input.significant) return true;
  if (input.lastRecordedAt === null) return true;
  const elapsedSeconds =
    (input.recordedAt.getTime() - input.lastRecordedAt.getTime()) / 1000;
  return elapsedSeconds >= WAYPOINT_MIN_INTERVAL_SECONDS;
}

export class DispatchRepository {
  constructor(private readonly database: PostgresConnection) {}

  /**
   * Resolves the driver record for an acting membership.
   *
   * Driver identity is never taken from a request: a client-supplied driver id would
   * let one driver act as another. It is derived from the membership the session has
   * already proved.
   */
  async driverIdForMembership(membershipId: string): Promise<string | undefined> {
    return (await this.database.query<{ driverId: string }>(
      `SELECT driver_id AS "driverId" FROM drivers WHERE membership_id = $1`,
      [membershipId],
    )).rows[0]?.driverId;
  }

  /**
   * Creates a new dispatch offer for a driver and notifies them immediately.
   *
   * The notification is written inside the same transaction as the offer, so the
   * driver never receives an alert for an offer that failed to persist. The copy
   * is intentionally PHI-free: only fee and coarse distance are referenced, never
   * recipient identity or address.
   */
  async createOffer(input: {
    dispatchJobId: string; driverId: string; feeSen: number;
    approxDistanceMetres: number | null; expiresAt: Date;
    correlationId: string; now: Date;
  }): Promise<OfferSummary> {
    return this.database.transaction(async (client) => {
      const created = (await client.query<OfferSummaryRow>(
        `INSERT INTO dispatch_offers
         (dispatch_job_id, driver_id, fee_sen, approx_distance_metres, expires_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5)
         RETURNING offer_id AS "offerId", dispatch_job_id AS "dispatchJobId",
           fee_sen::integer AS "feeSen", approx_distance_metres AS "approxDistanceMetres",
           expires_at AS "expiresAt", version::integer AS "version"`,
        [input.dispatchJobId, input.driverId, input.feeSen,
          input.approxDistanceMetres, input.expiresAt],
      )).rows[0]!;
      await this.notifyDriver(client, {
        driverId: input.driverId,
        titleCode: 'dispatch.offer.title',
        bodyCode: 'dispatch.offer.body',
        resourceType: 'dispatch_offer',
        resourceId: created.offerId,
        correlationId: input.correlationId,
        now: input.now,
      });
      return created;
    });
  }

  async listVehicles(driverId: string): Promise<VehicleRecord[]> {
    return (await this.database.query<VehicleRow>(
      `SELECT vehicle_id AS "vehicleId", plate_number AS "plateNumber",
         vehicle_type AS "vehicleType", active, version,
         created_at AS "createdAt", updated_at AS "updatedAt"
       FROM vehicles WHERE driver_id = $1 ORDER BY active DESC, created_at, vehicle_id`,
      [driverId],
    )).rows;
  }

  async createVehicle(input: {
    driverId: string; plateNumber: string; vehicleType: string;
    actorProfileId: string; correlationId: string; now: Date;
  }): Promise<VehicleRecord | 'duplicate'> {
    try {
      return await this.database.transaction(async (client) => {
        const context = (await client.query<{ organizationId: string }>(
          'SELECT organization_id AS "organizationId" FROM drivers WHERE driver_id = $1',
          [input.driverId],
        )).rows[0];
        if (context === undefined) throw new Error('Driver record disappeared');
        const created = (await client.query<VehicleRow>(
          `INSERT INTO vehicles (driver_id, plate_number, vehicle_type, updated_at)
           VALUES ($1,$2,$3,$4)
           RETURNING vehicle_id AS "vehicleId", plate_number AS "plateNumber",
             vehicle_type AS "vehicleType", active, version,
             created_at AS "createdAt", updated_at AS "updatedAt"`,
          [input.driverId, input.plateNumber, input.vehicleType, input.now],
        )).rows[0]!;
        await this.auditDriverObject(client, context.organizationId, input.actorProfileId,
          'driver.vehicle.created', 'vehicle', created.vehicleId, input.correlationId, input.now);
        return created;
      });
    } catch (error) {
      if (databaseCode(error) === '23505') return 'duplicate';
      throw error;
    }
  }

  async updateVehicle(input: {
    driverId: string; vehicleId: string; plateNumber: string; vehicleType: string;
    active: boolean; expectedVersion: number; actorProfileId: string;
    correlationId: string; now: Date;
  }): Promise<VehicleRecord | 'not_found' | 'version_conflict' | 'duplicate'> {
    try {
      return await this.database.transaction(async (client) => {
        const current = (await client.query<{ version: number; organizationId: string }>(
          `SELECT vehicle.version, driver.organization_id AS "organizationId"
           FROM vehicles AS vehicle JOIN drivers AS driver ON driver.driver_id = vehicle.driver_id
           WHERE vehicle.vehicle_id = $1 AND vehicle.driver_id = $2 FOR UPDATE OF vehicle`,
          [input.vehicleId, input.driverId],
        )).rows[0];
        if (current === undefined) return 'not_found';
        if (current.version !== input.expectedVersion) return 'version_conflict';
        const updated = (await client.query<VehicleRow>(
          `UPDATE vehicles SET plate_number = $2, vehicle_type = $3, active = $4,
             version = version + 1, updated_at = $5 WHERE vehicle_id = $1
           RETURNING vehicle_id AS "vehicleId", plate_number AS "plateNumber",
             vehicle_type AS "vehicleType", active, version,
             created_at AS "createdAt", updated_at AS "updatedAt"`,
          [input.vehicleId, input.plateNumber, input.vehicleType, input.active, input.now],
        )).rows[0]!;
        await this.auditDriverObject(client, current.organizationId, input.actorProfileId,
          'driver.vehicle.updated', 'vehicle', updated.vehicleId, input.correlationId, input.now);
        return updated;
      });
    } catch (error) {
      if (databaseCode(error) === '23505') return 'duplicate';
      throw error;
    }
  }

  async createDeliveryRating(input: {
    deliveryId: string; patientProfileId: string; stars: number;
    correlationId: string; now: Date;
  }): Promise<DeliveryRatingRecord | 'not_found' | 'not_completed' | 'duplicate'> {
    try {
      return await this.database.transaction(async (client) => {
        const delivery = (await client.query<{
          driverId: string; organizationId: string;
        }>(
          `SELECT assignment.driver_id AS "driverId", order_record.organization_id AS "organizationId"
           FROM deliveries AS delivery
           JOIN pharmacy_orders AS order_record
             ON order_record.pharmacy_order_id = delivery.pharmacy_order_id
           JOIN dispatch_assignments AS assignment
             ON assignment.dispatch_job_id = delivery.dispatch_job_id
           WHERE delivery.delivery_id = $1 AND order_record.patient_profile_id = $2
             AND assignment.status = 'completed'`,
          [input.deliveryId, input.patientProfileId],
        )).rows[0];
        if (delivery === undefined) {
          const owned = await client.query(
            `SELECT 1 FROM deliveries AS delivery JOIN pharmacy_orders AS order_record
               ON order_record.pharmacy_order_id = delivery.pharmacy_order_id
             WHERE delivery.delivery_id = $1 AND order_record.patient_profile_id = $2`,
            [input.deliveryId, input.patientProfileId],
          );
          return owned.rowCount === 1 ? 'not_completed' : 'not_found';
        }
        const created = (await client.query<DeliveryRatingRow>(
          `INSERT INTO delivery_ratings (delivery_id, driver_id, stars, created_at)
           VALUES ($1,$2,$3,$4)
           RETURNING rating_id AS "ratingId", delivery_id AS "deliveryId", stars,
             created_at AS "createdAt"`,
          [input.deliveryId, delivery.driverId, input.stars, input.now],
        )).rows[0]!;
        await this.auditDriverObject(client, delivery.organizationId, input.patientProfileId,
          'delivery.rating.created', 'delivery_rating', created.ratingId,
          input.correlationId, input.now);
        return created;
      });
    } catch (error) {
      if (databaseCode(error) === '23505') return 'duplicate';
      throw error;
    }
  }

  async listDriverRatings(driverId: string, limit: number): Promise<{
    readonly data: DeliveryRatingRecord[]; readonly averageStars: number | null;
    readonly totalRatings: number;
  }> {
    const data = (await this.database.query<DeliveryRatingRow>(
      `SELECT rating_id AS "ratingId", delivery_id AS "deliveryId", stars,
         created_at AS "createdAt" FROM delivery_ratings
       WHERE driver_id = $1 ORDER BY created_at DESC, rating_id DESC LIMIT $2`,
      [driverId, limit],
    )).rows;
    const aggregate = (await this.database.query<{ averageStars: string | null; totalRatings: number }>(
      `SELECT round(avg(stars)::numeric, 2)::text AS "averageStars",
         count(*)::integer AS "totalRatings" FROM delivery_ratings WHERE driver_id = $1`,
      [driverId],
    )).rows[0];
    return {
      data,
      averageStars: aggregate?.averageStars === null || aggregate?.averageStars === undefined
        ? null : Number(aggregate.averageStars),
      totalRatings: aggregate?.totalRatings ?? 0,
    };
  }

  private async notifyDriver(
    client: PoolClient,
    input: {
      driverId: string; titleCode: string; bodyCode: string;
      resourceType: string; resourceId: string; correlationId: string; now: Date;
    },
  ): Promise<void> {
    const driver = (await client.query<{ profileId: string }>(
      `SELECT profile_id AS "profileId" FROM drivers WHERE driver_id = $1`,
      [input.driverId],
    )).rows[0];
    if (driver === undefined) return;
    await createNotification(client, {
      profileId: driver.profileId,
      category: 'dispatch',
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      titleCode: input.titleCode,
      bodyCode: input.bodyCode,
      correlationId: input.correlationId,
      now: input.now,
    });
  }

  private async auditDriverObject(
    client: PoolClient, organizationId: string, actorProfileId: string, action: string,
    objectType: string, objectId: string, correlationId: string, now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
       (audit_id,organization_id,actor_profile_id,action,object_type,object_id,
        correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,$3,$4,$5,$6,$7)`,
      [organizationId, actorProfileId, action, objectType, objectId, correlationId, now],
    );
  }


  /** Offers a driver may still act on, carrying no recipient identity. */
  async listOpenOffers(driverId: string, now: Date): Promise<OfferSummary[]> {
    return (await this.database.query<OfferSummaryRow>(
      `SELECT offer_id AS "offerId", dispatch_job_id AS "dispatchJobId",
         fee_sen::integer AS "feeSen",
         approx_distance_metres AS "approxDistanceMetres", expires_at AS "expiresAt",
         version::integer AS "version"
       FROM dispatch_offers
       WHERE driver_id = $1 AND status = 'pending' AND expires_at > $2
       ORDER BY expires_at ASC, offer_id ASC`,
      [driverId, now],
    )).rows;
  }

  /**
   * Lists a driver's own assignments, ordered by urgency rather than recency: the
   * active ones a driver still owes progress on come first (most recently assigned
   * first), then the completed ones (most recently completed first). Cancelled and
   * failed assignments are never returned here — a driver tracking their work does
   * not need them in this view, and including them would push actionable rows down.
   *
   * The fee is joined from `dispatch_jobs`; an assignment does not store it, so the
   * fee can never disagree with the job it serves.
   */
  async listDriverAssignments(input: {
    readonly driverId: string;
    readonly status: 'active' | 'completed' | 'all';
    readonly limit: number;
  }): Promise<AssignmentSummary[]> {
    const activeList = ACTIVE_ASSIGNMENT_STATUSES.map((s) => `'${s}'`).join(',');
    // CASE places active rows before completed rows regardless of any timestamp, so a
    // freshly-completed assignment never jumps above one still being worked.
    const statusFilter = input.status === 'all'
      ? `AND assignment.status IN (${activeList},'completed')`
      : input.status === 'active'
        ? `AND assignment.status IN (${activeList})`
        : `AND assignment.status = 'completed'`;
    return (await this.database.query<AssignmentSummaryRow>(
      `SELECT assignment.assignment_id AS "assignmentId",
         assignment.dispatch_job_id AS "dispatchJobId",
         assignment.status::text AS "status",
         assignment.assigned_at AS "assignedAt",
         assignment.completed_at AS "completedAt",
         job.fee_sen::integer AS "feeSen",
         assignment.version AS "version"
       FROM dispatch_assignments AS assignment
       JOIN dispatch_jobs AS job ON job.dispatch_job_id = assignment.dispatch_job_id
       WHERE assignment.driver_id = $1 ${statusFilter}
       ORDER BY
         CASE WHEN assignment.status IN (${activeList}) THEN 0 ELSE 1 END,
         assignment.assigned_at DESC,
         assignment.completed_at DESC,
         assignment.assignment_id DESC
       LIMIT $2`,
      [input.driverId, input.limit],
    )).rows;
  }

  /**
   * Read a single assignment owned by the calling driver. Returns undefined when
   * the row does not exist OR is owned by a different driver; the two cases are
   * deliberately indistinguishable to avoid leaking that another driver's
   * assignment exists at the same id.
   */
  async getDriverAssignment(input: {
    readonly driverId: string;
    readonly assignmentId: string;
  }): Promise<AssignmentSummary | undefined> {
    const row = (await this.database.query<AssignmentSummaryRow>(
      `SELECT assignment.assignment_id AS "assignmentId",
         assignment.dispatch_job_id AS "dispatchJobId",
         assignment.status::text AS "status",
         assignment.assigned_at AS "assignedAt",
         assignment.completed_at AS "completedAt",
         job.fee_sen::integer AS "feeSen",
         assignment.version AS "version"
       FROM dispatch_assignments AS assignment
       JOIN dispatch_jobs AS job ON job.dispatch_job_id = assignment.dispatch_job_id
       WHERE assignment.driver_id = $1 AND assignment.assignment_id = $2`,
      [input.driverId, input.assignmentId],
    )).rows[0];
    return row;
  }

  /**
   * Accepts an offer, creates the assignment and withdraws every competing offer,
   * atomically.
   *
   * Serializable because three racing conditions must all hold at commit: the offer
   * is still pending and unexpired, no other offer for the job has been accepted,
   * and this driver has no other active assignment. The partial unique indexes are
   * the real guarantee; this transaction turns the race into an ordered outcome
   * instead of a constraint error for the loser.
   */
  async acceptOffer(input: {
    offerId: string; driverId: string; vehicleId: string | null;
    expectedVersion: number; now: Date; correlationId: string;
  }): Promise<{ assignmentId: string; dispatchJobId: string; version: number } | DispatchFailure> {
    return this.database.serializableTransaction(async (client) => {
      const offer = (await client.query<{
        dispatchJobId: string; driverId: string; status: DispatchOfferStatus;
        feeSen: number; expiresAt: Date; version: number;
      }>(
        `SELECT dispatch_job_id AS "dispatchJobId", driver_id AS "driverId", status,
           fee_sen::integer AS "feeSen", expires_at AS "expiresAt", version
         FROM dispatch_offers WHERE offer_id = $1 FOR UPDATE`,
        [input.offerId],
      )).rows[0];
      if (offer === undefined) return 'not_found';
      if (offer.driverId !== input.driverId) return 'not_found';
      if (offer.version !== input.expectedVersion) return 'version_conflict';
      if (offer.status !== 'pending') return 'offer_taken';
      // An expired offer is refused rather than honoured: the job may already have
      // been offered onward, and reviving it would create a second claimant.
      if (offer.expiresAt <= input.now) return 'offer_expired';
      if (input.vehicleId !== null) {
        const vehicle = await client.query(
          `SELECT 1 FROM vehicles WHERE vehicle_id = $1 AND driver_id = $2 AND active`,
          [input.vehicleId, input.driverId],
        );
        if (vehicle.rowCount !== 1) return 'vehicle_unknown';
      }

      const job = (await client.query<{ status: DispatchJobStatus; version: number }>(
        `SELECT status, version FROM dispatch_jobs WHERE dispatch_job_id = $1 FOR UPDATE`,
        [offer.dispatchJobId],
      )).rows[0];
      if (job === undefined) return 'not_found';
      if (job.status !== 'pending' && job.status !== 'offering') return 'offer_taken';

      const busy = await client.query(
        `SELECT assignment_id FROM dispatch_assignments
         WHERE driver_id = $1
           AND status IN ('assigned','en_route_pickup','arrived_pickup','picked_up','en_route_dropoff','arrived_dropoff')
         FOR UPDATE`,
        [input.driverId],
      );
      if (busy.rowCount !== 0) return 'driver_busy';

      await client.query(
        `UPDATE dispatch_offers SET status = 'accepted', responded_at = $2,
           version = version + 1, updated_at = $2
         WHERE offer_id = $1`,
        [input.offerId, input.now],
      );
      // Every competing offer is withdrawn in the same transaction, so no other
      // driver is left holding an offer for a job that is already taken.
      await client.query(
        `UPDATE dispatch_offers SET status = 'withdrawn', version = version + 1, updated_at = $3
         WHERE dispatch_job_id = $1 AND offer_id <> $2 AND status = 'pending'`,
        [offer.dispatchJobId, input.offerId, input.now],
      );
      const assignment = (await client.query<{ assignmentId: string; version: number }>(
        `INSERT INTO dispatch_assignments
         (dispatch_job_id, driver_id, vehicle_id, offer_id, assigned_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5) RETURNING assignment_id AS "assignmentId", version`,
        [offer.dispatchJobId, input.driverId, input.vehicleId, input.offerId, input.now],
      )).rows[0]!;
      await client.query(
        `UPDATE dispatch_jobs SET status = 'assigned', version = version + 1, updated_at = $2
         WHERE dispatch_job_id = $1`,
        [offer.dispatchJobId, input.now],
      );
      await client.query(
        `UPDATE drivers SET availability = 'busy', version = version + 1, updated_at = $2
         WHERE driver_id = $1`,
        [input.driverId, input.now],
      );
      await this.publishAssignment(client, assignment.assignmentId, offer.dispatchJobId,
        null, 'assigned', input.driverId, input.correlationId, input.now);
      return { assignmentId: assignment.assignmentId, dispatchJobId: offer.dispatchJobId, version: assignment.version };
    });
  }

  /**
   * Recipient contact and address, disclosed ONLY while the requesting driver holds
   * an active assignment for that delivery. The relationship is part of the query,
   * so a driver whose assignment ended reads nothing rather than stale details.
   */
  async recipientForActiveAssignment(
    assignmentId: string, driverId: string,
  ): Promise<RecipientDisclosure | undefined> {
    return (await this.database.query<RecipientRow>(
      `SELECT delivery.delivery_id AS "deliveryId",
         delivery.recipient_name AS "recipientName",
         delivery.recipient_phone_e164 AS "recipientPhoneE164",
         delivery.address_line1 AS "addressLine1", delivery.address_line2 AS "addressLine2",
         delivery.postcode, delivery.city, delivery.state_code AS "stateCode"
       FROM dispatch_assignments assignment
       JOIN deliveries delivery ON delivery.dispatch_job_id = assignment.dispatch_job_id
       WHERE assignment.assignment_id = $1 AND assignment.driver_id = $2
         AND assignment.status IN ('assigned','en_route_pickup','arrived_pickup','picked_up','en_route_dropoff','arrived_dropoff')`,
      [assignmentId, driverId],
    )).rows[0];
  }

  /**
   * Ordered stops of the assignment's dispatch job, disclosed ONLY while the
   * requesting driver holds an active assignment. Mirrors the recipient
   * disclosure exactly: the ownership + active-status join is part of the
   * query, so not-found, another driver's assignment, and an ended assignment
   * are all deliberately indistinguishable (undefined → 404 at the service).
   * A job with no stops yet reads the same way; the client falls back to a
   * driver-only map.
   */
  async stopsForActiveAssignment(
    assignmentId: string, driverId: string,
  ): Promise<DispatchStop[] | undefined> {
    const rows = (await this.database.query<DispatchStopRow>(
      `SELECT stop.kind::text AS "kind",
         stop.sequence_no AS "sequenceNo",
         stop.latitude::text AS "latitude",
         stop.longitude::text AS "longitude"
       FROM dispatch_assignments assignment
       JOIN dispatch_stops stop ON stop.dispatch_job_id = assignment.dispatch_job_id
       WHERE assignment.assignment_id = $1 AND assignment.driver_id = $2
         AND assignment.status IN ('assigned','en_route_pickup','arrived_pickup','picked_up','en_route_dropoff','arrived_dropoff')
       ORDER BY stop.sequence_no ASC`,
      [assignmentId, driverId],
    )).rows;
    return rows.length === 0 ? undefined : rows;
  }

  /** Advances an assignment one step, refusing skips and terminal reopening. */
  async advanceAssignment(input: {
    assignmentId: string; driverId: string; nextStatus: DispatchAssignmentStatus;
    reasonCode: string | null; expectedVersion: number; now: Date; correlationId: string;
  }): Promise<{ status: DispatchAssignmentStatus; version: number } | DispatchFailure> {
    return this.database.transaction(async (client) => {
      const current = (await client.query<{
        dispatchJobId: string; driverId: string; status: DispatchAssignmentStatus; version: number;
      }>(
        `SELECT dispatch_job_id AS "dispatchJobId", driver_id AS "driverId", status, version
         FROM dispatch_assignments WHERE assignment_id = $1 FOR UPDATE`,
        [input.assignmentId],
      )).rows[0];
      if (current === undefined || current.driverId !== input.driverId) return 'not_found';
      if (current.version !== input.expectedVersion) return 'version_conflict';
      if (!assignmentTransitionAllowed(current.status, input.nextStatus)) return 'invalid_transition';
      // A completed delivery must already carry proof; the database trigger also
      // refuses to pay for an unproven one.
      if (input.nextStatus === 'completed') {
        const proof = await client.query(
          `SELECT delivery_proof_id FROM delivery_proofs WHERE assignment_id = $1`,
          [input.assignmentId],
        );
        if (proof.rowCount === 0) return 'proof_required';
      }
      // Derived in TypeScript; see the `42P08` note on consultation transitions.
      const completedAt = input.nextStatus === 'completed' ? input.now : null;
      const updated = (await client.query<{ version: number }>(
        `UPDATE dispatch_assignments SET status = $2, reason_code = $3,
           completed_at = COALESCE($5, completed_at),
           version = version + 1, updated_at = $4
         WHERE assignment_id = $1
         RETURNING version`,
        [input.assignmentId, input.nextStatus, input.reasonCode, input.now, completedAt],
      )).rows[0]!;
      if (['completed', 'cancelled', 'failed'].includes(input.nextStatus)) {
        await client.query(
          `UPDATE drivers SET availability = 'available', version = version + 1, updated_at = $2
           WHERE driver_id = $1 AND availability = 'busy'`,
          [input.driverId, input.now],
        );
      }
      await this.publishAssignment(client, input.assignmentId, current.dispatchJobId,
        current.status, input.nextStatus, input.driverId, input.correlationId, input.now);
      return { status: input.nextStatus, version: updated.version };
    });
  }

  /**
   * Stores a waypoint if the throttle permits it.
   *
   * Returns `throttled` rather than an error: a client reporting too often is
   * normal behaviour, not a fault, and treating it as an error would make drivers
   * retry and amplify the load this throttle exists to reduce.
   */
  async recordWaypoint(input: {
    assignmentId: string; driverId: string; latitude: number; longitude: number;
    accuracyMetres: number | null; significant: boolean; recordedAt: Date; now: Date;
  }): Promise<'stored' | 'throttled' | DispatchFailure> {
    return this.database.transaction(async (client) => {
      const assignment = (await client.query<{ status: DispatchAssignmentStatus }>(
        `SELECT status FROM dispatch_assignments
         WHERE assignment_id = $1 AND driver_id = $2`,
        [input.assignmentId, input.driverId],
      )).rows[0];
      if (assignment === undefined) return 'not_found';
      if (['completed', 'cancelled', 'failed'].includes(assignment.status)) return 'not_assigned';
      const last = (await client.query<{ recordedAt: Date }>(
        `SELECT recorded_at AS "recordedAt" FROM location_waypoints
         WHERE assignment_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
        [input.assignmentId],
      )).rows[0];
      if (!waypointAccepted({
        lastRecordedAt: last?.recordedAt ?? null,
        recordedAt: input.recordedAt,
        significant: input.significant,
      })) return 'throttled';
      await client.query(
        `INSERT INTO location_waypoints
         (assignment_id, driver_id, latitude, longitude, accuracy_metres,
          significant, recorded_at, received_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [input.assignmentId, input.driverId, input.latitude, input.longitude,
          input.accuracyMetres, input.significant, input.recordedAt, input.now],
      );
      return 'stored';
    });
  }

  /** Driver balance as a projection over the append-only earnings ledger. */
  async earningsBalanceSen(driverId: string): Promise<number> {
    const result = await this.database.query<{ balance: string }>(
      `SELECT COALESCE(SUM(amount_sen), 0)::text AS balance
       FROM driver_earning_events WHERE driver_id = $1`,
      [driverId],
    );
    return Number(result.rows[0]?.balance ?? '0');
  }

  /**
   * Registers a payout bank account.
   *
   * Only the last four digits are retained in clear and the account is held as a digest, matching
   * the column design: a full account number is a payment credential, so it is never stored in
   * the open nor returned. A new account SUPERSEDES the previous one rather than accumulating,
   * because two active accounts would make "where does this driver's money go" ambiguous at
   * payout time.
   */
  async registerBankAccount(input: {
    readonly driverId: string;
    readonly bankCode: string;
    readonly accountNumber: string;
  }): Promise<{ readonly bankAccountId: string; readonly last4: string }> {
    const digits = input.accountNumber.replace(/\D/g, '');
    const last4 = digits.slice(-4);
    const hash = createHash('sha256').update(`${input.bankCode}:${digits}`).digest('hex');
    return this.database.transaction(async (client) => {
      await client.query(
        'UPDATE driver_bank_accounts SET active = false WHERE driver_id = $1 AND active',
        [input.driverId],
      );
      const created = await client.query<{ bankAccountId: string }>(
        `INSERT INTO driver_bank_accounts (driver_id, bank_code, account_last4, account_hash)
         VALUES ($1,$2,$3,$4)
         RETURNING bank_account_id AS "bankAccountId"`,
        [input.driverId, input.bankCode, last4, hash],
      );
      return { bankAccountId: created.rows[0]!.bankAccountId, last4 };
    });
  }

  /**
   * Requests a withdrawal.
   *
   * SERIALIZABLE, because affordability is checked against a PROJECTION of the earnings ledger
   * and two concurrent requests could each pass against the same balance and together exceed it
   * — the same oversell shape as inventory, applied to money. A partial unique index
   * independently permits only one in-flight withdrawal per driver.
   *
   * Available balance subtracts money already committed to an in-flight or completed withdrawal.
   * Counting earnings alone would let one balance be withdrawn twice.
   */
  async requestWithdrawal(input: {
    readonly driverId: string;
    readonly bankAccountId: string;
    readonly amountSen: number;
  }): Promise<{ readonly ok: true; readonly withdrawalId: string; readonly remainingSen: number }
    | { readonly ok: false; readonly availableSen: number;
      readonly reason: 'account_unknown' | 'insufficient_balance' | 'already_in_flight' }> {
    try {
      return await this.database.serializableTransaction(async (client) => {
        const account = await client.query(
          `SELECT 1 FROM driver_bank_accounts
            WHERE bank_account_id = $1 AND driver_id = $2 AND active`,
          [input.bankAccountId, input.driverId],
        );
        if ((account.rowCount ?? 0) === 0) {
          return { ok: false as const, reason: 'account_unknown' as const, availableSen: 0 };
        }
        const earned = await client.query<{ total: string }>(
          `SELECT COALESCE(sum(amount_sen), 0)::text AS total
             FROM driver_earning_events WHERE driver_id = $1`,
          [input.driverId],
        );
        const committed = await client.query<{ total: string }>(
          `SELECT COALESCE(sum(amount_sen), 0)::text AS total
             FROM driver_withdrawals
            WHERE driver_id = $1
              AND status IN ('requested','under_review','approved','processing','paid')`,
          [input.driverId],
        );
        const available = Number(earned.rows[0]?.total ?? '0')
          - Number(committed.rows[0]?.total ?? '0');
        if (input.amountSen > available) {
          return {
            ok: false as const, reason: 'insufficient_balance' as const, availableSen: available,
          };
        }
        const created = await client.query<{ withdrawalId: string }>(
          `INSERT INTO driver_withdrawals (driver_id, bank_account_id, amount_sen)
           VALUES ($1,$2,$3) RETURNING withdrawal_id AS "withdrawalId"`,
          [input.driverId, input.bankAccountId, input.amountSen],
        );
        return {
          ok: true as const,
          withdrawalId: created.rows[0]!.withdrawalId,
          remainingSen: available - input.amountSen,
        };
      });
    } catch (error) {
      const code = typeof error === 'object' && error !== null
        ? (error as { readonly code?: unknown }).code : undefined;
      // The one-in-flight index. Also caught for a serialization conflict, since two racing
      // requests are exactly what that index exists to arbitrate.
      if (code === '23505') return { ok: false, reason: 'already_in_flight', availableSen: 0 };
      throw error;
    }
  }

  async findWithdrawal(withdrawalId: string): Promise<{
    readonly withdrawalId: string; readonly driverId: string; readonly amountSen: number;
    readonly status: string; readonly version: number; readonly organizationId: string;
    readonly driverProfileId: string;
  } | null> {
    const found = await this.database.query<{
      withdrawalId: string; driverId: string; amountSen: string; status: string;
      version: number; organizationId: string; driverProfileId: string;
    }>(
      `SELECT w.withdrawal_id AS "withdrawalId", w.driver_id AS "driverId",
              w.amount_sen AS "amountSen", w.status::text AS status, w.version,
              d.organization_id AS "organizationId", d.profile_id AS "driverProfileId"
         FROM driver_withdrawals AS w
         JOIN drivers AS d ON d.driver_id = w.driver_id
        WHERE w.withdrawal_id = $1`,
      [withdrawalId],
    );
    const record = found.rows[0];
    if (record === undefined) return null;
    return { ...record, amountSen: Number(record.amountSen) };
  }

  /**
   * Advances a withdrawal through the catalogue lifecycle
   * `requested → under_review → approved → processing → paid`, with `rejected`, `cancelled` and
   * `failed` as reasoned outcomes.
   *
   * Reaching `paid` posts the balanced ledger entry AND binds it to the withdrawal in one
   * transaction; the database refuses `paid` without a ledger entry, so the two cannot drift.
   * `failed` is distinct from `rejected` on purpose: a bank transfer that bounced is not an
   * operator refusal, and conflating them would hide which of the two happened.
   */
  async advanceWithdrawal(input: {
    readonly withdrawalId: string;
    readonly next: string;
    readonly reasonCode: string | null;
    readonly reviewerMembershipId: string | null;
    readonly expectedVersion: number;
    readonly payableAccountId?: string | undefined;
    readonly cashAccountId?: string | undefined;
    readonly correlationId: string;
  }): Promise<{ readonly ok: true; readonly status: string;
      readonly ledgerEntryId: string | null }
    | { readonly ok: false;
      readonly reason: 'conflict' | 'state' | 'self_review' | 'accounts_required' }> {
    return this.database.transaction(async (client) => {
      const locked = await client.query<{
        status: string; version: number; amountSen: string;
        organizationId: string; driverProfileId: string;
      }>(
        `SELECT w.status::text AS status, w.version, w.amount_sen AS "amountSen",
                d.organization_id AS "organizationId", d.profile_id AS "driverProfileId"
           FROM driver_withdrawals AS w
           JOIN drivers AS d ON d.driver_id = w.driver_id
          WHERE w.withdrawal_id = $1 FOR UPDATE OF w`,
        [input.withdrawalId],
      );
      const current = locked.rows[0];
      if (current === undefined) return { ok: false as const, reason: 'state' as const };
      if (current.version !== input.expectedVersion) {
        return { ok: false as const, reason: 'conflict' as const };
      }
      if (!withdrawalTransitionAllowed(current.status, input.next)) {
        return { ok: false as const, reason: 'state' as const };
      }
      // A driver must never review their own withdrawal. The permission is disjoint by role and
      // a migration asserts that, but one person holding both memberships would otherwise
      // approve their own payout.
      if (input.reviewerMembershipId !== null) {
        const reviewer = await client.query<{ profileId: string }>(
          'SELECT profile_id AS "profileId" FROM organization_memberships WHERE membership_id = $1',
          [input.reviewerMembershipId],
        );
        if (reviewer.rows[0]?.profileId === current.driverProfileId) {
          return { ok: false as const, reason: 'self_review' as const };
        }
      }
      let ledgerEntryId: string | null = null;
      if (input.next === 'paid') {
        if (input.payableAccountId === undefined || input.cashAccountId === undefined) {
          return { ok: false as const, reason: 'accounts_required' as const };
        }
        const amount = Number(current.amountSen);
        ledgerEntryId = await postBalancedEntry(client, {
          organizationId: current.organizationId,
          kind: 'driver_withdrawal',
          referenceType: 'driver_withdrawal',
          referenceId: input.withdrawalId,
          memoCode: 'withdrawal_settled',
          reversesEntryId: null,
          // Clearing a payable: debit the liability, credit cash.
          postings: [
            { ledgerAccountId: input.payableAccountId, amountSen: amount },
            { ledgerAccountId: input.cashAccountId, amountSen: -amount },
          ],
          correlationId: input.correlationId,
        });
      }
      await client.query(
        `UPDATE driver_withdrawals
            SET status = $2::withdrawal_status,
                reason_code = $3,
                reviewed_by_membership_id = COALESCE($4, reviewed_by_membership_id),
                ledger_entry_id = COALESCE($5, ledger_entry_id),
                version = version + 1, updated_at = now()
          WHERE withdrawal_id = $1`,
        [input.withdrawalId, input.next, input.reasonCode,
          input.reviewerMembershipId, ledgerEntryId],
      );
      return { ok: true as const, status: input.next, ledgerEntryId };
    });
  }

  async expireOffers(now: Date, limit: number): Promise<number> {
    return this.database.transaction(async (client) => {
      const expired = await client.query<{ offerId: string; dispatchJobId: string; driverId: string }>(
        `UPDATE dispatch_offers SET status = 'expired', version = version + 1, updated_at = $1
         WHERE offer_id IN (
           SELECT offer_id FROM dispatch_offers
           WHERE status = 'pending' AND expires_at <= $1
           ORDER BY expires_at LIMIT $2 FOR UPDATE SKIP LOCKED
         )
         RETURNING offer_id AS "offerId", dispatch_job_id AS "dispatchJobId", driver_id AS "driverId"`,
        [now, limit],
      );
      for (const offer of expired.rows) {
        await client.query(
          `INSERT INTO outbox_events
           (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
            payload,correlation_id,occurred_at)
           VALUES (uuidv7(),$1,$2,'dispatch_offer',$3,0,$4::jsonb,uuidv7(),$5)`,
          [DISPATCH_OFFER_EXPIRED_EVENT_TYPE, DISPATCH_OFFER_EXPIRED_EVENT_VERSION,
            offer.offerId, JSON.stringify({
              offer_id: offer.offerId, dispatch_job_id: offer.dispatchJobId,
            }), now],
        );
        // Notify the driver that their offer expired before they could respond.
        await this.notifyDriver(client, {
          driverId: offer.driverId,
          titleCode: 'dispatch.offer.title',
          bodyCode: 'dispatch.offer.body',
          resourceType: 'dispatch_offer',
          resourceId: offer.offerId,
          correlationId: randomUUID(),
          now,
        });
      }
      return expired.rowCount ?? 0;
    });
  }

  private async publishAssignment(
    client: PoolClient, assignmentId: string, dispatchJobId: string,
    previous: DispatchAssignmentStatus | null, next: DispatchAssignmentStatus,
    driverId: string, correlationId: string, now: Date,
  ): Promise<void> {
    // Minimum data: no recipient identity, no address, no coordinates.
    await client.query(
      `INSERT INTO outbox_events
       (event_id,event_type,event_version,aggregate_type,aggregate_id,aggregate_version,
        payload,correlation_id,occurred_at)
       VALUES (uuidv7(),$1,$2,'dispatch_assignment',$3,0,$4::jsonb,$5,$6)`,
      [DISPATCH_ASSIGNMENT_CHANGED_EVENT_TYPE, DISPATCH_ASSIGNMENT_CHANGED_EVENT_VERSION,
        assignmentId, JSON.stringify({
          assignment_id: assignmentId,
          dispatch_job_id: dispatchJobId,
          previous_status: previous,
          status: next,
        }), correlationId, now],
    );
    // Notify the driver about the assignment status change. The notification is
    // written in the same transaction as the outbox event, so the driver never
    // receives an alert for an assignment that failed to update.
    await this.notifyDriver(client, {
      driverId,
      titleCode: 'dispatch.assignment.title',
      bodyCode: 'dispatch.assignment.body',
      resourceType: 'dispatch_assignment',
      resourceId: assignmentId,
      correlationId,
      now,
    });
  }
}


function databaseCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as { readonly code?: string }).code
    : undefined;
}
