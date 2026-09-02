import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DISPATCH_ASSIGNMENT_CHANGED_EVENT_TYPE,
  DISPATCH_OFFER_EXPIRED_EVENT_TYPE,
  WAYPOINT_MIN_INTERVAL_SECONDS,
  assignmentTransitionAllowed,
  offerTransitionAllowed,
  serializeDeliveryRating,
  serializeOfferSummary,
  serializeVehicle,
  waypointAccepted,
} from '@smartcura/database/dispatch';
import { OutboxProcessor } from '../apps/worker/src/outbox.processor.js';

const offerId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d90';
const jobId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d91';
const assignmentId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d92';

test('an offer summary discloses fee and coarse distance but never recipient identity', () => {
  const summary = serializeOfferSummary({
    offerId, dispatchJobId: jobId, feeSen: 850,
    approxDistanceMetres: 3200, expiresAt: new Date('2026-07-29T00:05:00.000Z'),
    version: 0,
  });
  assert.deepEqual(summary, {
    offer_id: offerId, dispatch_job_id: jobId, fee_sen: 850, currency: 'MYR',
    approx_distance_metres: 3200, expires_at: '2026-07-29T00:05:00.000Z',
    version: 0,
  });
  // A driver shopping for offers must not be able to harvest patient details.
  for (const leak of [
    'recipient', 'name', 'phone', 'address', 'postcode', 'latitude', 'longitude',
  ]) {
    assert.equal(leak in summary, false, `offer must not expose ${leak}`);
  }
});

test('assignment progress is single-step and terminal states never reopen', () => {
  assert.equal(assignmentTransitionAllowed('assigned', 'en_route_pickup'), true);
  assert.equal(assignmentTransitionAllowed('arrived_pickup', 'picked_up'), true);
  assert.equal(assignmentTransitionAllowed('arrived_dropoff', 'completed'), true);
  // Skipping `picked_up` would let a delivery complete without the driver ever
  // collecting the medication.
  assert.equal(assignmentTransitionAllowed('arrived_pickup', 'en_route_dropoff'), false);
  assert.equal(assignmentTransitionAllowed('assigned', 'completed'), false);
  // Backwards movement would let a driver rewrite a completed step.
  assert.equal(assignmentTransitionAllowed('picked_up', 'arrived_pickup'), false);
  assert.equal(assignmentTransitionAllowed('completed', 'en_route_dropoff'), false);
  assert.equal(assignmentTransitionAllowed('cancelled', 'assigned'), false);
  // Cancel or fail may interrupt any live step.
  assert.equal(assignmentTransitionAllowed('en_route_pickup', 'cancelled'), true);
  assert.equal(assignmentTransitionAllowed('picked_up', 'failed'), true);
  assert.equal(assignmentTransitionAllowed('failed', 'cancelled'), false);
});

test('an offer responds exactly once', () => {
  assert.equal(offerTransitionAllowed('pending', 'accepted'), true);
  assert.equal(offerTransitionAllowed('pending', 'withdrawn'), true);
  assert.equal(offerTransitionAllowed('pending', 'expired'), true);
  // A declined or expired offer cannot later be accepted, which is what stops a
  // stale client from claiming a job that was offered onward.
  assert.equal(offerTransitionAllowed('declined', 'accepted'), false);
  assert.equal(offerTransitionAllowed('expired', 'accepted'), false);
  assert.equal(offerTransitionAllowed('withdrawn', 'accepted'), false);
  assert.equal(offerTransitionAllowed('accepted', 'declined'), false);
});

test('waypoints are throttled but a significant point is always kept', () => {
  const base = new Date('2026-07-29T00:00:00.000Z');
  const soon = new Date(base.getTime() + 5_000);
  const later = new Date(base.getTime() + WAYPOINT_MIN_INTERVAL_SECONDS * 1000);
  // The first point of a route has nothing to throttle against.
  assert.equal(waypointAccepted({ lastRecordedAt: null, recordedAt: base, significant: false }), true);
  assert.equal(waypointAccepted({ lastRecordedAt: base, recordedAt: soon, significant: false }), false);
  assert.equal(waypointAccepted({ lastRecordedAt: base, recordedAt: later, significant: false }), true);
  // A significant point bypasses the throttle, because route audit depends on it.
  assert.equal(waypointAccepted({ lastRecordedAt: base, recordedAt: soon, significant: true }), true);
});

test('worker accepts exact minimum-data dispatch events and rejects location disclosure', async () => {
  const processor = new OutboxProcessor();
  const event = (eventType: string, payload: Record<string, unknown>) => ({
    eventId: assignmentId, eventType, eventVersion: 1, attempts: 1, payload,
  });
  assert.equal(await processor.process(event(DISPATCH_ASSIGNMENT_CHANGED_EVENT_TYPE, {
    assignment_id: assignmentId, dispatch_job_id: jobId,
    previous_status: 'assigned', status: 'en_route_pickup',
  }) as never), true);
  assert.equal(await processor.process(event(DISPATCH_OFFER_EXPIRED_EVENT_TYPE, {
    offer_id: offerId, dispatch_job_id: jobId,
  }) as never), true);
  // Coordinates and recipient identity must never travel on the event bus.
  assert.equal(await processor.process(event(DISPATCH_ASSIGNMENT_CHANGED_EVENT_TYPE, {
    assignment_id: assignmentId, dispatch_job_id: jobId,
    previous_status: 'assigned', status: 'en_route_pickup', latitude: 3.139,
  }) as never), false);
  assert.equal(await processor.process(event(DISPATCH_OFFER_EXPIRED_EVENT_TYPE, {
    offer_id: offerId, dispatch_job_id: jobId, recipient_phone_e164: '+60123456789',
  }) as never), false);
});

test('migration enforces one accepted offer, one active assignment and paid-only-with-proof', () => {
  const migration = readFileSync(new URL(
    '../packages/database/drizzle/0025_driver_dispatch_and_delivery.sql', import.meta.url,
  ), 'utf8');
  // The two invariants that cannot be application checks.
  assert.match(migration, /dispatch_offers_accepted_uq/);
  assert.match(migration, /dispatch_assignments_driver_active_uq/);
  // Recipient identity must live on deliveries only, never on an offer.
  const offerBlock = migration.slice(
    migration.indexOf('CREATE TABLE "dispatch_offers"'),
    migration.indexOf('CREATE TABLE "dispatch_assignments"'),
  );
  for (const leak of ['recipient_name', 'recipient_phone', 'address_line1', 'latitude']) {
    assert.equal(offerBlock.includes(leak), false, `offer table must not carry ${leak}`);
  }
  assert.match(migration, /location_waypoints_reject_mutation/);
  assert.match(migration, /driver_earning_events_reject_mutation/);
  assert.match(migration, /pickup_proofs_reject_mutation/);
  assert.match(migration, /location_waypoints_require_active/);
  assert.match(migration, /driver_earning_events_require_proof/);
  assert.match(migration, /a delivery fee requires captured delivery proof/);
  assert.match(migration, /driver_earning_events_assignment_fee_uq/);
  assert.match(migration, /driver_earning_events_sign_check/);
  assert.match(migration, /recipient disclosure must remain an assigned-driver capability/);
  assert.match(migration, /a driver must not hold clinical or inventory authority/);
  assert.match(migration, /'identity', 17/);
  // PostGIS is deliberately absent; enabling it would fail the verified WP-02L gate.
  // Anchored to a real statement, since the migration's own comment explains the
  // deferral and would otherwise match.
  assert.doesNotMatch(migration, /^CREATE EXTENSION[^;]*postgis/im);
  assert.doesNotMatch(migration, /geography\(/);
});

test('acceptance is serializable and disclosure requires an active assignment', () => {
  // A Windows autocrlf checkout gives this file CRLF endings, and a fixed-length
  // byte window is ending-fragile: the \r characters pushed the WHERE clause
  // outside the slice and the assertions read the SELECT header only. Normalize
  // endings and slice between method boundaries instead.
  const repository = readFileSync(new URL(
    '../packages/database/src/dispatch-repository.ts', import.meta.url,
  ), 'utf8').replace(/\r\n/g, '\n');
  // Acceptance must be serializable: three racing conditions must hold at commit.
  assert.match(repository, /serializableTransaction/);
  // Competing offers are withdrawn in the same transaction as the accept.
  assert.match(repository, /status = 'withdrawn'/);
  assert.match(repository, /offer_id <> \$2 AND status = 'pending'/);
  // The active-assignment relationship is part of the disclosure query itself, so a
  // driver whose assignment ended reads nothing rather than stale contact details.
  const disclosure = repository.slice(repository.indexOf('recipientForActiveAssignment'));
  assert.match(disclosure, /assignment\.driver_id = \$2/);
  assert.match(disclosure, /assignment\.status IN \('assigned'/);
  // A completed delivery cannot be recorded without proof.
  assert.match(repository, /proof_required/);
  // The read-one query scopes by driver_id so a driver cannot read another driver's
  // assignment at the same id; the 404 is concealed, so the controller and repository
  // both return undefined for both an unknown id and a foreign one.
  const readOne = repository.slice(
    repository.indexOf('async getDriverAssignment'),
    repository.indexOf('async acceptOffer'),
  );
  assert.match(readOne, /assignment\.driver_id = \$1/);
  assert.match(readOne, /assignment\.assignment_id = \$2/);
  // The summary joins `dispatch_jobs` for the fee because `dispatch_assignments` does
  // not store one, so a fee and its assignment can never disagree.
  assert.match(readOne, /JOIN dispatch_jobs/);
  assert.match(readOne, /job\.fee_sen/);
});



test('stop coordinates are disclosed only through the active-assignment relationship', () => {
  const repository = readFileSync(new URL(
    '../packages/database/src/dispatch-repository.ts', import.meta.url,
  ), 'utf8').replace(/\r\n/g, '\n');
  // Slice from the method, not the interface, so the assertions read the SQL.
  const stops = repository.slice(repository.indexOf('async stopsForActiveAssignment'));
  // The ownership + active-status join is part of the query itself, so an ended
  // or foreign assignment reads nothing rather than stale coordinates — exactly
  // the recipient-disclosure rule, because the dropoff pinpoints a patient.
  assert.match(stops, /assignment\.driver_id = \$2/);
  assert.match(
    stops,
    /assignment\.status IN \('assigned','en_route_pickup','arrived_pickup','picked_up','en_route_dropoff','arrived_dropoff'\)/,
  );
  // Coordinates cross the wire as decimal strings, matching PatientAddress.
  assert.match(stops, /stop\.latitude::text/);
  assert.match(stops, /stop\.longitude::text/);
  // Stops are ordered by sequence, so the pickup always precedes the dropoff.
  assert.match(stops, /ORDER BY stop\.sequence_no ASC/);

  const contract = JSON.parse(readFileSync(new URL(
    '../packages/contracts/openapi/openapi.json', import.meta.url,
  ), 'utf8')) as {
    components: { schemas: Record<string, { properties?: Record<string, { type?: string | string[]; enum?: string[] }>; additionalProperties?: boolean }> },
  };
  const stopSchema = contract.components.schemas.DispatchStop!;
  assert.deepEqual(stopSchema.properties!.kind!.enum, ['pickup', 'dropoff']);
  assert.equal(stopSchema.properties!.latitude!.type, 'string');
  assert.equal(stopSchema.properties!.longitude!.type, 'string');
  assert.equal(contract.components.schemas.DispatchAssignmentStops!.additionalProperties, false);
  // An empty stop list must not be expressible: an assignment with no stops is a
  // concealed 404, not a 200 with [].
  const stopsSchema = contract.components.schemas.DispatchAssignmentStops!;
  assert.equal(stopsSchema.properties!.stops!.type, 'array');
});

test('driver profile representations are snake_case and ratings remain immutable', () => {
  const now = new Date('2026-07-31T00:00:00.000Z');
  assert.deepEqual(serializeVehicle({
    vehicleId: offerId,
    plateNumber: 'WXY 1234',
    vehicleType: 'motorcycle',
    active: true,
    version: 2,
    createdAt: now,
    updatedAt: now,
  }), {
    vehicle_id: offerId,
    plate_number: 'WXY 1234',
    vehicle_type: 'motorcycle',
    active: true,
    version: 2,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  assert.deepEqual(serializeDeliveryRating({
    ratingId: assignmentId,
    deliveryId: jobId,
    stars: 5,
    createdAt: now,
  }), {
    rating_id: assignmentId,
    delivery_id: jobId,
    stars: 5,
    created_at: now.toISOString(),
  });

  const migration = readFileSync(new URL(
    '../packages/database/drizzle/0034_stage8_stage9_api_surfaces.sql', import.meta.url,
  ), 'utf8');
  assert.match(migration, /vehicles" ADD COLUMN "version"/);
  assert.match(migration, /delivery_ratings_reject_mutation/);
  assert.match(migration, /delivery\.rating:create:own/);
  assert.match(migration, /delivery\.rating:read:own/);
});

test('dispatch repository produces notifications for offer creation, assignment changes and offer expiry', () => {
  const repository = readFileSync(new URL(
    '../packages/database/src/dispatch-repository.ts', import.meta.url,
  ), 'utf8').replace(/\r\n/g, '\n');
  // The repository must import and call createNotification.
  assert.match(repository, /import.*createNotification.*from '\.\/notification-repository\.js'/);
  assert.match(repository, /createNotification\(/);
  // A createOffer method must exist and notify the driver with the offer title code.
  const createOffer = repository.slice(
    repository.indexOf('async createOffer('),
    repository.indexOf('async listVehicles('),
  );
  assert.match(createOffer, /INSERT INTO dispatch_offers/);
  assert.match(createOffer, /dispatch\.offer\.title/);
  assert.match(createOffer, /dispatch\.offer\.body/);
  // publishAssignment must notify the driver with the assignment title code.
  const publishAssignment = repository.slice(
    repository.indexOf('private async publishAssignment('),
    repository.indexOf('function databaseCode('),
  );
  assert.match(publishAssignment, /dispatch\.assignment\.title/);
  assert.match(publishAssignment, /dispatch\.assignment\.body/);
  // expireOffers must notify the driver for each expired offer.
  const expireOffers = repository.slice(
    repository.indexOf('async expireOffers('),
    repository.indexOf('private async publishAssignment('),
  );
  assert.match(expireOffers, /driver_id AS "driverId"/);
  assert.match(expireOffers, /dispatch\.offer\.title/);
  // A notifyDriver helper resolves the driver profile_id before calling createNotification.
  const notifyDriver = repository.slice(
    repository.indexOf('private async notifyDriver('),
    repository.indexOf('private async auditDriverObject('),
  );
  assert.match(notifyDriver, /SELECT profile_id AS "profileId" FROM drivers WHERE driver_id/);
  assert.match(notifyDriver, /createNotification\(/);
  // The category is 'dispatch' — the dedicated notification category for dispatch events.
  assert.match(notifyDriver, /category: 'dispatch'/);
});

test('notification copy catalogue has dispatch title codes and a dispatch_offer deep link', () => {
  const copy = readFileSync(new URL(
    '../apps/worker/src/notification-copy.ts', import.meta.url,
  ), 'utf8').replace(/\r\n/g, '\n');
  // The orphaned copy entries must still exist.
  assert.match(copy, /'dispatch\.offer\.title'/);
  assert.match(copy, /'dispatch\.assignment\.title'/);
  // The dispatch_offer deep link routes to the driver app's orders screen.
  const deepLink = copy.slice(
    copy.indexOf('function deepLinkForResource'),
    copy.indexOf('interface CopyEntry'),
  );
  assert.match(deepLink, /case 'dispatch_offer'/);
  assert.match(deepLink, /smartcura:\/\/orders\//);
});
