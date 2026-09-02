import { Injectable } from '@nestjs/common';
import {
  PharmacyRepository,
  pharmacyOrderRequestHash,
  serializeMedication,
  serializePharmacyOrder,
  type PharmacyOrderStatus,
} from '@smartcura/database/pharmacy';
import {
  DispatchRepository,
  serializeAssignmentSummary,
  serializeDeliveryRating,
  serializeOfferSummary,
  serializeVehicle,
} from '@smartcura/database/dispatch';
import type { ZodType } from 'zod';
import type { AuthenticatedSession } from '../platform/request-authorization.js';
import { correlationId, problem, validationFailed } from '../platform/problems.js';
import {
  acceptDispatchOfferSchema,
  advanceAssignmentSchema,
  createDeliveryRatingSchema,
  createMedicationSchema,
  createPharmacyOrderSchema,
  createVehicleSchema,
  dispatchPharmacyOrderSchema,
  inventoryAvailabilityQuerySchema,
  listDriverRatingsQuerySchema,
  listDriverAssignmentsQuerySchema,
  listInventoryBatchesQuerySchema,
  listMedicationsQuerySchema,
  listPharmacyOrdersQuerySchema,
  listStockMovementsQuerySchema,
  recordWaypointSchema,
  registerBankAccountSchema,
  requestWithdrawalSchema,
  advanceWithdrawalSchema,
  transitionPharmacyOrderSchema,
  updateMedicationSchema,
  updateVehicleSchema,
  validatePharmacyOrderSchema,
} from './logistics-request.schemas.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** How long a FEFO hold survives before the sweeper releases it. */
const RESERVATION_TTL_MS = 900_000;

@Injectable()
export class LogisticsService {
  constructor(
    private readonly pharmacy: PharmacyRepository,
    private readonly dispatch: DispatchRepository,
  ) {}

  async listMedications(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listMedicationsQuerySchema, queryValue);
    this.pharmacyMembership(current, 'pharmacy.catalogue:read:site');
    const records = await this.pharmacy.listMedications({
      includeRetired: query.include_retired, limit: query.page_size,
    });
    return { data: records.map(serializeMedication) };
  }

  async readMedication(current: AuthenticatedSession, medicationIdValue: string) {
    this.pharmacyMembership(current, 'pharmacy.catalogue:read:site');
    const record = await this.pharmacy.findMedication(id(medicationIdValue));
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Medication was not found');
    return serializeMedication(record);
  }

  async createMedication(current: AuthenticatedSession, value: unknown) {
    const request = parse(createMedicationSchema, value);
    const active = this.pharmacyMembership(current, 'pharmacy.catalogue:manage:site');
    // This endpoint can set the controlled-substance flag, so the whole mutation
    // is step-up protected rather than trusting the client to classify sensitivity.
    this.requireStepUp(current);
    const result = await this.pharmacy.createMedication({
      genericName: request.generic_name,
      atcCode: request.atc_code,
      controlledSchedule: request.controlled_schedule,
      requiresPrescription: request.requires_prescription,
      organizationId: active.organizationId,
      actorProfileId: current.aggregate.profile.profileId,
      correlationId: correlationId(),
      now: new Date(),
    });
    if (result === 'duplicate') {
      throw problem(409, 'MEDICATION_ALREADY_EXISTS', 'An active medication uses that name');
    }
    return serializeMedication(result);
  }

  async updateMedication(
    current: AuthenticatedSession, medicationIdValue: string, value: unknown,
  ) {
    const request = parse(updateMedicationSchema, value);
    const active = this.pharmacyMembership(current, 'pharmacy.catalogue:manage:site');
    this.requireStepUp(current);
    const result = await this.pharmacy.updateMedication({
      medicationId: id(medicationIdValue),
      genericName: request.generic_name,
      atcCode: request.atc_code,
      controlledSchedule: request.controlled_schedule,
      requiresPrescription: request.requires_prescription,
      retired: request.retired,
      expectedVersion: request.expected_version,
      organizationId: active.organizationId,
      actorProfileId: current.aggregate.profile.profileId,
      correlationId: correlationId(),
      now: new Date(),
    });
    if (result === 'not_found') throw problem(404, 'RESOURCE_NOT_FOUND', 'Medication was not found');
    if (result === 'version_conflict') {
      throw problem(409, 'MEDICATION_VERSION_CONFLICT', 'The medication changed');
    }
    if (result === 'duplicate') {
      throw problem(409, 'MEDICATION_ALREADY_EXISTS', 'An active medication uses that name');
    }
    return serializeMedication(result);
  }

  async batches(current: AuthenticatedSession, siteIdValue: string, queryValue: unknown) {
    const query = parse(listInventoryBatchesQuerySchema, queryValue);
    const active = this.pharmacyMembership(current, 'inventory:read:site', siteIdValue);
    const records = await this.pharmacy.listBatches({
      siteId: active.siteId,
      variantId: query.variant_id,
      limit: query.page_size,
    });
    return {
      site_id: active.siteId,
      data: records.map((record) => ({
        batch_id: record.batchId,
        variant_id: record.variantId,
        lot_number: record.lotNumber,
        expires_on: record.expiresOn,
        status: record.status,
        posted_quantity: record.postedQuantity,
        reserved_quantity: record.reservedQuantity,
        available_quantity: record.availableQuantity,
      })),
    };
  }

  async stockMovements(
    current: AuthenticatedSession, siteIdValue: string, queryValue: unknown,
  ) {
    const query = parse(listStockMovementsQuerySchema, queryValue);
    const active = this.pharmacyMembership(current, 'inventory:read:site', siteIdValue);
    const records = await this.pharmacy.listStockMovements({
      siteId: active.siteId,
      batchId: query.batch_id,
      limit: query.page_size,
    });
    return {
      site_id: active.siteId,
      data: records.map((record) => ({
        movement_id: record.movementId,
        batch_id: record.batchId,
        movement_type: record.movementType,
        quantity_delta: record.quantityDelta,
        reference_type: record.referenceType,
        reference_id: record.referenceId,
        reason_code: record.reasonCode,
        occurred_at: record.occurredAt.toISOString(),
      })),
    };
  }

  async createOrder(
    current: AuthenticatedSession, idempotencyKey: string, value: unknown,
  ) {
    const request = parse(createPharmacyOrderSchema, value);
    const active = this.patient(current, 'pharmacy.order:create:own');
    const result = await this.pharmacy.createOrder({
      organizationId: active.organizationId,
      siteId: request.site_id,
      patientProfileId: current.aggregate.profile.profileId,
      prescriptionId: request.prescription_id,
      items: request.items.map((item) => ({
        variantId: item.variant_id, quantity: item.quantity,
      })),
      actorProfileId: current.aggregate.profile.profileId,
      idempotencyKey,
      requestHash: pharmacyOrderRequestHash(request),
      now: new Date(),
      correlationId: correlationId(),
    });
    if (result === 'site_unknown') throw problem(404, 'RESOURCE_NOT_FOUND', 'Site was not found');
    if (result === 'prescription_invalid') {
      throw problem(409, 'PHARMACY_PRESCRIPTION_INVALID', 'A current signed prescription is required');
    }
    if (result === 'variant_unknown') {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'A medication variant was not found');
    }
    if (result === 'idempotency_reused') {
      throw problem(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was reused');
    }
    return 'snapshot' in result ? result.snapshot : serializePharmacyOrder(result.record);
  }

  async listOrders(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listPharmacyOrdersQuerySchema, queryValue);
    const active = this.active(current);
    let patientProfileId: string | undefined;
    let siteId: string | undefined;
    if (active.roleId === 'patient') {
      if (!active.permissions.includes('pharmacy.order:read:own')) {
        throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
      }
      patientProfileId = current.aggregate.profile.profileId;
    } else if (active.roleId === 'pharmacy') {
      const pharmacy = this.pharmacyMembership(
        current, 'pharmacy.order:read:site', query.site_id,
      );
      siteId = pharmacy.siteId;
    } else {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const records = await this.pharmacy.listOrders({
      patientProfileId,
      siteId,
      status: query.status as PharmacyOrderStatus | undefined,
      limit: query.page_size,
    });
    return { data: records.map(serializePharmacyOrder) };
  }

  /**
   * Reads one pharmacy order by id. Same dual scope as `listOrders`: a patient
   * sees only their own order, a pharmacy membership sees only orders at their
   * assigned sites. An out-of-scope or absent order is answered 404, never 403,
   * so the route cannot be used to confirm whether another person's order exists.
   */
  async readOrder(current: AuthenticatedSession, pharmacyOrderIdValue: string) {
    const pharmacyOrderId = id(pharmacyOrderIdValue);
    const active = this.active(current);
    let patientProfileId: string | undefined;
    let siteIds: readonly string[] | undefined;
    if (active.roleId === 'patient') {
      if (!active.permissions.includes('pharmacy.order:read:own')) {
        throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
      }
      patientProfileId = current.aggregate.profile.profileId;
    } else if (active.roleId === 'pharmacy') {
      if (!active.permissions.includes('pharmacy.order:read:site')) {
        throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
      }
      siteIds = active.siteIds ?? [];
      if (siteIds.length === 0) {
        throw problem(403, 'OBJECT_ACCESS_DENIED', 'A pharmacy site assignment is required');
      }
    } else {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const record = await this.pharmacy.findOrder({ pharmacyOrderId, patientProfileId, siteIds });
    if (record === undefined) throw problem(404, 'RESOURCE_NOT_FOUND', 'Pharmacy order was not found');
    return serializePharmacyOrder(record);
  }

  async listVehicles(current: AuthenticatedSession) {
    const driver = await this.driver(current, 'driver.vehicle:manage:own');
    return { data: (await this.dispatch.listVehicles(driver.driverId)).map(serializeVehicle) };
  }

  async createVehicle(current: AuthenticatedSession, value: unknown) {
    const request = parse(createVehicleSchema, value);
    const driver = await this.driver(current, 'driver.vehicle:manage:own');
    const result = await this.dispatch.createVehicle({
      driverId: driver.driverId,
      plateNumber: request.plate_number,
      vehicleType: request.vehicle_type,
      actorProfileId: current.aggregate.profile.profileId,
      correlationId: correlationId(),
      now: new Date(),
    });
    if (result === 'duplicate') {
      throw problem(409, 'VEHICLE_PLATE_CONFLICT', 'An active vehicle uses that plate');
    }
    return serializeVehicle(result);
  }

  async updateVehicle(current: AuthenticatedSession, vehicleIdValue: string, value: unknown) {
    const request = parse(updateVehicleSchema, value);
    const driver = await this.driver(current, 'driver.vehicle:manage:own');
    const result = await this.dispatch.updateVehicle({
      driverId: driver.driverId,
      vehicleId: id(vehicleIdValue),
      plateNumber: request.plate_number,
      vehicleType: request.vehicle_type,
      active: request.active,
      expectedVersion: request.expected_version,
      actorProfileId: current.aggregate.profile.profileId,
      correlationId: correlationId(),
      now: new Date(),
    });
    if (result === 'not_found') throw problem(404, 'RESOURCE_NOT_FOUND', 'Vehicle was not found');
    if (result === 'version_conflict') {
      throw problem(409, 'VEHICLE_VERSION_CONFLICT', 'The vehicle changed');
    }
    if (result === 'duplicate') {
      throw problem(409, 'VEHICLE_PLATE_CONFLICT', 'An active vehicle uses that plate');
    }
    return serializeVehicle(result);
  }

  async createDeliveryRating(
    current: AuthenticatedSession, deliveryIdValue: string, value: unknown,
  ) {
    const request = parse(createDeliveryRatingSchema, value);
    this.patient(current, 'delivery.rating:create:own');
    const result = await this.dispatch.createDeliveryRating({
      deliveryId: id(deliveryIdValue),
      patientProfileId: current.aggregate.profile.profileId,
      stars: request.stars,
      correlationId: correlationId(),
      now: new Date(),
    });
    if (result === 'not_found') throw problem(404, 'RESOURCE_NOT_FOUND', 'Delivery was not found');
    if (result === 'not_completed') {
      throw problem(409, 'DELIVERY_RATING_NOT_READY', 'Only a completed delivery can be rated');
    }
    if (result === 'duplicate') {
      throw problem(409, 'DELIVERY_ALREADY_RATED', 'The delivery already has a rating');
    }
    return serializeDeliveryRating(result);
  }

  async driverRatings(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listDriverRatingsQuerySchema, queryValue);
    const driver = await this.driver(current, 'delivery.rating:read:own');
    const result = await this.dispatch.listDriverRatings(driver.driverId, query.page_size);
    return {
      driver_id: driver.driverId,
      average_stars: result.averageStars,
      total_ratings: result.totalRatings,
      data: result.data.map(serializeDeliveryRating),
    };
  }

  /**
   * Per-batch availability for one variant at one site.
   *
   * Every figure is derived from the append-only ledger minus active reservations;
   * no stored balance is read, because a stored balance is what makes overselling
   * possible in the first place.
   */
  async availability(current: AuthenticatedSession, siteIdValue: string, queryValue: unknown) {
    const query = parse(inventoryAvailabilityQuerySchema, queryValue);
    const active = this.pharmacyMembership(current, 'inventory:read:site', siteIdValue);
    const batches = await this.pharmacy.availability({
      siteId: active.siteId, variantId: query.variant_id,
    });
    return {
      site_id: active.siteId,
      variant_id: query.variant_id,
      data: batches.map((batch) => ({
        batch_id: batch.batchId,
        expires_on: batch.expiresOn,
        posted_quantity: batch.postedQuantity,
        reserved_quantity: batch.reservedQuantity,
        available_quantity: batch.availableQuantity,
      })),
      // The figure a caller should act on, and the one the reservation command
      // recomputes under lock rather than trusting from a client.
      total_available_quantity: batches.reduce((sum, batch) => sum + batch.availableQuantity, 0),
    };
  }

  /** Atomic boundary 4: validation plus FEFO reservations or a reasoned failure. */
  async validateOrder(current: AuthenticatedSession, orderIdValue: string, value: unknown) {
    const orderId = id(orderIdValue);
    const request = parse(validatePharmacyOrderSchema, value);
    const active = this.pharmacyMembership(current, 'prescription_validation:manage:site');
    const result = await this.pharmacy.validateAndReserve({
      pharmacyOrderId: orderId,
      validationState: request.state,
      validationReasonCode: request.reason_code,
      validatorMembershipId: active.membershipId,
      validatorProfileId: current.aggregate.profile.profileId,
      expectedVersion: request.expected_version,
      reservationTtlMs: RESERVATION_TTL_MS,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result === 'string') return this.failure(result);
    return {
      pharmacy_order_id: orderId,
      status: result.status,
      reservations: result.reservations.map((line) => ({
        batch_id: line.batchId, quantity: line.quantity,
      })),
      // A valid prescription with unavailable stock ends at `validated` and names
      // the items that could not be filled, rather than silently short-filling.
      shortfall_order_item_ids: result.shortfallItems,
    };
  }

  /** Fulfilment progress between the two atomic boundaries. */
  async transitionOrder(current: AuthenticatedSession, orderIdValue: string, value: unknown) {
    const orderId = id(orderIdValue);
    const request = parse(transitionPharmacyOrderSchema, value);
    this.pharmacyMembership(current, 'pharmacy.order:update:site');
    const result = await this.pharmacy.transitionOrder({
      pharmacyOrderId: orderId,
      nextStatus: request.status,
      reasonCode: request.reason_code,
      expectedVersion: request.expected_version,
      actorProfileId: current.aggregate.profile.profileId,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (result !== request.status) return this.failure(result);
    return { pharmacy_order_id: orderId, status: result };
  }

  /** Atomic boundary 5: consume reservations, post the decrement, transition. */
  async dispatchOrder(current: AuthenticatedSession, orderIdValue: string, value: unknown) {
    const orderId = id(orderIdValue);
    const request = parse(dispatchPharmacyOrderSchema, value);
    this.pharmacyMembership(current, 'stock_ledger:post:site');
    const result = await this.pharmacy.dispatch({
      pharmacyOrderId: orderId,
      expectedVersion: request.expected_version,
      actorProfileId: current.aggregate.profile.profileId,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (result !== 'dispatched') return this.failure(result);
    return { pharmacy_order_id: orderId, status: 'dispatched' };
  }

  /** Open offers for the acting driver, carrying no recipient identity. */
  async listOffers(current: AuthenticatedSession) {
    const driver = await this.driver(current, 'dispatch.offer:read:assigned');
    const offers = await this.dispatch.listOpenOffers(driver.driverId, new Date());
    return { data: offers.map(serializeOfferSummary) };
  }

  /**
   * The acting driver's own assignments, ordered by urgency: active work first, then
   * completed history. Driver identity is derived from the membership, never the
   * request, so one driver cannot read another's queue. The `delivery:update:assigned`
   * permission is the same one advancing an assignment requires.
   */
  async listDriverAssignments(current: AuthenticatedSession, queryValue: unknown) {
    const query = parse(listDriverAssignmentsQuerySchema, queryValue);
    const driver = await this.driver(current, 'delivery:update:assigned');
    const records = await this.dispatch.listDriverAssignments({
      driverId: driver.driverId,
      status: query.status,
      limit: query.page_size,
    });
    return { data: records.map(serializeAssignmentSummary) };
  }

  async acceptOffer(current: AuthenticatedSession, offerIdValue: string, value: unknown) {
    const request = parse(acceptDispatchOfferSchema, value);
    const driver = await this.driver(current, 'dispatch.offer:respond:assigned');
    const result = await this.dispatch.acceptOffer({
      offerId: id(offerIdValue),
      driverId: driver.driverId,
      vehicleId: request.vehicle_id,
      expectedVersion: request.expected_version,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result === 'string') return this.failure(result);
    return {
      assignment_id: result.assignmentId,
      dispatch_job_id: result.dispatchJobId,
      status: 'assigned',
      version: result.version,
    };
  }

  /**
   * Reads a single assignment owned by the calling driver. The 404 is concealed:
   * whether an assignment exists at all is itself a small disclosure, so an unknown
   * id and one belonging to another driver return the same problem. The permission
   * is the same one advancing an assignment requires, so a driver who cannot
   * transition the assignment cannot read it either.
   */
  async getAssignment(current: AuthenticatedSession, assignmentIdValue: string) {
    const driver = await this.driver(current, 'delivery:update:assigned');
    const record = await this.dispatch.getDriverAssignment({
      driverId: driver.driverId, assignmentId: id(assignmentIdValue),
    });
    if (record === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Assignment was not found');
    }
    return serializeAssignmentSummary(record);
  }

  /**
   * Recipient contact and address, disclosed only while this driver holds an active
   * assignment. Anything else is a concealed 404: whether a delivery exists for
   * someone else is itself sensitive.
   */
  async recipient(current: AuthenticatedSession, assignmentIdValue: string) {
    const driver = await this.driver(current, 'delivery.recipient:read:assigned');
    const disclosure = await this.dispatch.recipientForActiveAssignment(
      id(assignmentIdValue), driver.driverId,
    );
    if (disclosure === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Assignment was not found');
    }
    return {
      delivery_id: disclosure.deliveryId,
      recipient_name: disclosure.recipientName,
      recipient_phone_e164: disclosure.recipientPhoneE164,
      address_line1: disclosure.addressLine1,
      address_line2: disclosure.addressLine2,
      postcode: disclosure.postcode,
      city: disclosure.city,
      state_code: disclosure.stateCode,
    };
  }

  /**
   * Ordered navigation stops (pickup, then dropoff) for the assignment the
   * caller is actively working, with coordinates. Anything else is a concealed
   * 404, exactly as the recipient disclosure: the dropoff coordinates pinpoint
   * a patient's address, so whether an assignment exists is itself sensitive.
   */
  async stops(current: AuthenticatedSession, assignmentIdValue: string) {
    const driver = await this.driver(current, 'delivery:update:assigned');
    const assignmentId = id(assignmentIdValue);
    const stops = await this.dispatch.stopsForActiveAssignment(
      assignmentId, driver.driverId,
    );
    if (stops === undefined) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Assignment was not found');
    }
    return {
      assignment_id: assignmentId,
      stops: stops.map((stop) => ({
        kind: stop.kind,
        sequence_no: stop.sequenceNo,
        latitude: stop.latitude,
        longitude: stop.longitude,
      })),
    };
  }

  async advanceAssignment(current: AuthenticatedSession, assignmentIdValue: string, value: unknown) {
    const request = parse(advanceAssignmentSchema, value);
    const driver = await this.driver(current, 'delivery:update:assigned');
    const result = await this.dispatch.advanceAssignment({
      assignmentId: id(assignmentIdValue),
      driverId: driver.driverId,
      nextStatus: request.status,
      reasonCode: request.reason_code,
      expectedVersion: request.expected_version,
      now: new Date(),
      correlationId: correlationId(),
    });
    if (typeof result === 'string') return this.failure(result);
    if (result.status !== request.status) return this.failure('transition_invalid');
    return { assignment_id: id(assignmentIdValue), status: result.status, version: result.version };
  }

  async recordWaypoint(current: AuthenticatedSession, assignmentIdValue: string, value: unknown) {
    const request = parse(recordWaypointSchema, value);
    const driver = await this.driver(current, 'location.waypoint:create:assigned');
    const result = await this.dispatch.recordWaypoint({
      assignmentId: id(assignmentIdValue),
      driverId: driver.driverId,
      latitude: request.latitude,
      longitude: request.longitude,
      accuracyMetres: request.accuracy_metres,
      significant: request.significant,
      recordedAt: new Date(request.recorded_at),
      now: new Date(),
    });
    // `throttled` is a normal outcome, not a fault: reporting too often is expected
    // client behaviour, and returning an error would make drivers retry and amplify
    // the load the throttle exists to reduce.
    if (result === 'stored' || result === 'throttled') {
      return { assignment_id: id(assignmentIdValue), outcome: result };
    }
    return this.failure(result);
  }

  /** Balance projected over the append-only earnings ledger. */
  async earnings(current: AuthenticatedSession) {
    const driver = await this.driver(current, 'earning:read:own');
    return {
      driver_id: driver.driverId,
      currency: 'MYR',
      balance_sen: await this.dispatch.earningsBalanceSen(driver.driverId),
    };
  }

  /** Recent re-authentication, per the step-up matrix in policy-matrix.md. */
  private requireStepUp(current: AuthenticatedSession) {
    const validUntil = current.aggregate.session.stepUpValidUntil ?? null;
    if (validUntil === null || validUntil.getTime() <= Date.now()) {
      throw problem(403, 'STEP_UP_REQUIRED', 'Recent step-up authentication is required');
    }
  }

  private active(current: AuthenticatedSession) {
    const active = current.aggregate.memberships.find(
      (entry) => entry.membershipId === current.aggregate.session.activeMembershipId,
    );
    if (active === undefined || active.status !== 'active') {
      throw problem(403, 'MEMBERSHIP_INACTIVE', 'An active membership is required');
    }
    if (current.aggregate.profile.status !== 'active' ||
        current.aggregate.profile.onboardingCompletedAt === null) {
      throw problem(403, 'PERMISSION_DENIED', 'Profile onboarding is incomplete');
    }
    return active;
  }

  /**
   * Site authority. Inventory is site-specific, so the acting membership must be a
   * pharmacy membership at the site in the path; a matching organization is not
   * enough, because one branch must not reserve another branch's shelf.
   */
  private pharmacyMembership(
    current: AuthenticatedSession, permission: string, siteIdValue?: string,
  ) {
    const active = this.active(current);
    if (active.roleId !== 'pharmacy') {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    if (!active.permissions.includes(permission)) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const siteIds = active.siteIds ?? [];
    if (siteIdValue === undefined) {
      const [only] = siteIds;
      if (only === undefined) {
        throw problem(403, 'OBJECT_ACCESS_DENIED', 'A pharmacy site assignment is required');
      }
      return {
        membershipId: active.membershipId,
        organizationId: active.organizationId,
        siteId: only,
      };
    }
    const siteId = id(siteIdValue);
    // Concealed rather than refused: confirming which sites exist is itself a leak.
    if (!siteIds.includes(siteId)) {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Site was not found');
    }
    return {
      membershipId: active.membershipId,
      organizationId: active.organizationId,
      siteId,
    };
  }

  private patient(current: AuthenticatedSession, permission: string) {
    const active = this.active(current);
    if (active.roleId !== 'patient' || !active.permissions.includes(permission)) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    return { membershipId: active.membershipId, organizationId: active.organizationId };
  }

  private async driver(current: AuthenticatedSession, permission: string) {
    const active = this.active(current);
    if (active.roleId !== 'driver') {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    if (!active.permissions.includes(permission)) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    const driverId = await this.dispatch.driverIdForMembership(active.membershipId);
    if (driverId === undefined) {
      throw problem(403, 'OBJECT_ACCESS_DENIED', 'A driver record is required');
    }
    return { membershipId: active.membershipId, driverId };
  }

  /**
   * Registers a payout bank account. `policy-matrix.md` lists "Change bank details" as a driver
   * step-up action, and this is the obvious target for an account-takeover: redirecting a
   * driver's earnings needs no other access.
   */
  async registerBankAccount(current: AuthenticatedSession, value: unknown) {
    const request = parse(registerBankAccountSchema, value);
    const driver = await this.driver(current, 'driver.bank_account:manage:own');
    this.requireStepUp(current);
    const created = await this.dispatch.registerBankAccount({
      driverId: driver.driverId,
      bankCode: request.bank_code,
      accountNumber: request.account_number,
    });
    return {
      bank_account_id: created.bankAccountId,
      // Only the last four digits are ever echoed; the number itself is stored as a digest.
      account_last4: created.last4,
    };
  }

  /** `policy-matrix.md` lists "withdrawal" as a driver step-up action. */
  async requestWithdrawal(current: AuthenticatedSession, value: unknown) {
    const request = parse(requestWithdrawalSchema, value);
    const driver = await this.driver(current, 'withdrawal:create:own');
    this.requireStepUp(current);
    const result = await this.dispatch.requestWithdrawal({
      driverId: driver.driverId,
      bankAccountId: request.bank_account_id,
      amountSen: request.amount_sen,
    });
    if (!result.ok) {
      if (result.reason === 'already_in_flight') {
        throw problem(409, 'WITHDRAWAL_ALREADY_IN_FLIGHT',
          'A withdrawal is already in progress');
      }
      if (result.reason === 'insufficient_balance') {
        throw problem(409, 'WITHDRAWAL_INSUFFICIENT_BALANCE',
          'The requested amount exceeds the available balance');
      }
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Bank account was not found');
    }
    return {
      withdrawal_id: result.withdrawalId,
      status: 'requested',
      // Available balance is earnings minus money already committed to a withdrawal, so one
      // balance cannot be withdrawn twice.
      remaining_sen: result.remainingSen,
    };
  }

  /**
   * Advances a withdrawal. A driver may only cancel their own request; every other transition is
   * an administrative review capability, and a driver holding both would be approving their own
   * payout — which the repository refuses by comparing PROFILES, and a migration assertion keeps
   * the permissions disjoint by role.
   */
  async advanceWithdrawal(current: AuthenticatedSession, withdrawalIdValue: string, value: unknown) {
    const withdrawalId = id(withdrawalIdValue);
    const request = parse(advanceWithdrawalSchema, value);
    const active = this.active(current);
    const record = await this.dispatch.findWithdrawal(withdrawalId);
    if (record === null) throw problem(404, 'RESOURCE_NOT_FOUND', 'Withdrawal was not found');
    const isOwner = record.driverProfileId === current.aggregate.profile.profileId;
    const isReviewer = active.permissions.includes('withdrawal:review:organization')
      && active.organizationId === record.organizationId;
    if (request.status === 'cancelled') {
      if (!isOwner && !isReviewer) {
        throw problem(404, 'RESOURCE_NOT_FOUND', 'Withdrawal was not found');
      }
    } else if (!isReviewer) {
      throw problem(403, 'PERMISSION_DENIED', 'Access is not permitted');
    }
    if (request.status === 'approved' || request.status === 'paid') {
      this.requireStepUp(current);
    }
    const result = await this.dispatch.advanceWithdrawal({
      withdrawalId,
      next: request.status,
      reasonCode: request.reason_code,
      reviewerMembershipId: isReviewer ? active.membershipId : null,
      expectedVersion: request.expected_version,
      payableAccountId: request.payable_account_id ?? undefined,
      cashAccountId: request.cash_account_id ?? undefined,
      correlationId: correlationId(),
    });
    if (!result.ok) {
      if (result.reason === 'conflict') {
        throw problem(409, 'WITHDRAWAL_VERSION_CONFLICT', 'The withdrawal changed');
      }
      if (result.reason === 'self_review') {
        throw problem(403, 'WITHDRAWAL_SELF_REVIEW',
          'A driver cannot review their own withdrawal');
      }
      if (result.reason === 'accounts_required') {
        throw problem(422, 'VALIDATION_FAILED', 'Settlement requires both ledger accounts');
      }
      throw problem(409, 'WITHDRAWAL_TRANSITION_INVALID', 'The transition is not allowed');
    }
    return {
      withdrawal_id: withdrawalId,
      status: result.status,
      ledger_entry_id: result.ledgerEntryId,
    };
  }

  private failure(value: string): never {
    if (value === 'not_found' || value === 'wrong_site' || value === 'not_assigned' ||
        value === 'vehicle_unknown') {
      throw problem(404, 'RESOURCE_NOT_FOUND', 'Resource was not found');
    }
    if (value === 'version_conflict') {
      throw problem(409, 'LOGISTICS_VERSION_CONFLICT', 'The record changed');
    }
    if (value === 'insufficient_stock') {
      throw problem(409, 'INVENTORY_INSUFFICIENT_STOCK', 'Available stock is insufficient');
    }
    if (value === 'validation_required') {
      throw problem(409, 'PHARMACY_RESERVATION_REQUIRED', 'No active reservation to dispatch');
    }
    if (value === 'offer_expired') {
      throw problem(409, 'DISPATCH_OFFER_EXPIRED', 'The offer has expired');
    }
    if (value === 'offer_taken') {
      throw problem(409, 'DISPATCH_OFFER_TAKEN', 'The job is already assigned');
    }
    if (value === 'driver_busy') {
      throw problem(409, 'DISPATCH_DRIVER_BUSY', 'The driver already holds an active assignment');
    }
    if (value === 'proof_required') {
      throw problem(409, 'DELIVERY_PROOF_REQUIRED', 'Delivery proof is required before completion');
    }
    throw problem(409, 'LOGISTICS_TRANSITION_INVALID', 'The transition is not allowed');
  }
}

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationFailed();
  return result.data;
}

function id(value: string): string {
  if (!UUID_V7.test(value)) throw validationFailed();
  return value;
}
