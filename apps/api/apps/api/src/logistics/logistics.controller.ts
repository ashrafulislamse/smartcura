import {
  Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Res,
} from '@nestjs/common';
import {
  AuthenticatedOnly,
  CurrentSession, RequireCsrf, RequirePermission, type AuthenticatedSession,
} from '../platform/request-authorization.js';
import { problem } from '../platform/problems.js';
import { noStore, type ResponseLike } from '../platform/response-cache.js';
import { LogisticsService } from './logistics.service.js';


@AuthenticatedOnly()
@Controller('medications')
export class MedicationsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.listMedications(current, query);
  }

  @Post()
  @HttpCode(201)
  @RequireCsrf('pharmacy.medication.create')
  async create(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.createMedication(current, body);
  }

  @Get(':medicationId')
  async read(
    @CurrentSession() current: AuthenticatedSession,
    @Param('medicationId') medicationId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.readMedication(current, medicationId);
  }

  @Put(':medicationId')
  @RequireCsrf('pharmacy.medication.update')
  async update(
    @CurrentSession() current: AuthenticatedSession,
    @Param('medicationId') medicationId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.updateMedication(current, medicationId, body);
  }
}

/**
 * Site- and assignment-scoped authority cannot be decided by `PermissionGuard`,
 * which holds no object context, so these controllers declare
 * `@AuthenticatedOnly()` and the service proves the site membership or the active
 * assignment. Only genuinely `own`-scoped routes carry `@RequirePermission`.
 */
@AuthenticatedOnly()
@Controller('sites/:siteId/inventory')
export class InventoryController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get('availability')
  async availability(
    @CurrentSession() current: AuthenticatedSession,
    @Param('siteId') siteId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.availability(current, siteId, query);
  }

  @Get('batches')
  async batches(
    @CurrentSession() current: AuthenticatedSession,
    @Param('siteId') siteId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.batches(current, siteId, query);
  }

  @Get('movements')
  async movements(
    @CurrentSession() current: AuthenticatedSession,
    @Param('siteId') siteId: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.stockMovements(current, siteId, query);
  }
}

@AuthenticatedOnly()
@Controller('pharmacy-orders')
export class PharmacyOrdersController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.listOrders(current, query);
  }

  @Get(':pharmacyOrderId')
  async read(
    @CurrentSession() current: AuthenticatedSession,
    @Param('pharmacyOrderId') pharmacyOrderId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.readOrder(current, pharmacyOrderId);
  }

  @Post()
  @HttpCode(201)
  @RequireCsrf('pharmacy_order.create')
  async create(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    requireIdempotencyKey(idempotencyKey);
    return this.logistics.createOrder(current, idempotencyKey!, body);
  }

  @Post(':pharmacyOrderId/validation')
  @HttpCode(200)
  @RequireCsrf('pharmacy_order.validate')
  async validate(
    @CurrentSession() current: AuthenticatedSession,
    @Param('pharmacyOrderId') pharmacyOrderId: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    requireIdempotencyKey(idempotencyKey);
    return this.logistics.validateOrder(current, pharmacyOrderId, body);
  }

  @Put(':pharmacyOrderId/status')
  @RequireCsrf('pharmacy_order.transition')
  async transition(
    @CurrentSession() current: AuthenticatedSession,
    @Param('pharmacyOrderId') pharmacyOrderId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.transitionOrder(current, pharmacyOrderId, body);
  }

  @Post(':pharmacyOrderId/dispatch')
  @HttpCode(200)
  @RequireCsrf('pharmacy_order.dispatch')
  async dispatch(
    @CurrentSession() current: AuthenticatedSession,
    @Param('pharmacyOrderId') pharmacyOrderId: string,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    requireIdempotencyKey(idempotencyKey);
    return this.logistics.dispatchOrder(current, pharmacyOrderId, body);
  }
}

@AuthenticatedOnly()
@Controller('dispatch/offers')
export class DispatchOffersController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get()
  async list(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.listOffers(current);
  }

  @Post(':offerId/acceptance')
  @HttpCode(200)
  @RequireCsrf('dispatch_offer.accept')
  async accept(
    @CurrentSession() current: AuthenticatedSession,
    @Param('offerId') offerId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.acceptOffer(current, offerId, body);
  }
}

@AuthenticatedOnly()
@Controller('dispatch/assignments')
export class DispatchAssignmentsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get(':assignmentId/recipient')
  async recipient(
    @CurrentSession() current: AuthenticatedSession,
    @Param('assignmentId') assignmentId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.recipient(current, assignmentId);
  }

  @Get(':assignmentId/stops')
  async stops(
    @CurrentSession() current: AuthenticatedSession,
    @Param('assignmentId') assignmentId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.stops(current, assignmentId);
  }

  @Get(':assignmentId')
  async read(
    @CurrentSession() current: AuthenticatedSession,
    @Param('assignmentId') assignmentId: string,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.getAssignment(current, assignmentId);
  }

  @Put(':assignmentId/status')
  @RequireCsrf('dispatch_assignment.advance')
  async advance(
    @CurrentSession() current: AuthenticatedSession,
    @Param('assignmentId') assignmentId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.advanceAssignment(current, assignmentId, body);
  }

  @Post(':assignmentId/waypoints')
  @HttpCode(202)
  @RequireCsrf('location_waypoint.create')
  async waypoint(
    @CurrentSession() current: AuthenticatedSession,
    @Param('assignmentId') assignmentId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.recordWaypoint(current, assignmentId, body);
  }
}

@AuthenticatedOnly()
@Controller('drivers/me')
export class DriverEarningsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get('earnings')
  @RequirePermission('earning:read:own', 'driver.earnings.read')
  async earnings(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.earnings(current);
  }

  /**
   * Placed AFTER the earnings handler on purpose. Inserting these methods directly above the
   * `@RequirePermission` line left `@Get('earnings')` attached to a bank-account method and the
   * real earnings handler with no HTTP decorator at all, so one route answered the wrong verb and
   * the other vanished. Decorator adjacency is load-bearing.
   */
  @Post('bank-accounts')
  @RequireCsrf('driver.bank_account_register')
  async registerBankAccount(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Body() body: unknown,
  ) {
    // A payout destination is a payment credential; never cacheable.
    noStore(response);
    return this.logistics.registerBankAccount(current, body);
  }

  @Post('withdrawals')
  @RequireCsrf('driver.withdrawal_request')
  async requestWithdrawal(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
    @Body() body: unknown,
  ) {
    noStore(response);
    return this.logistics.requestWithdrawal(current, body);
  }

  @Get('vehicles')
  async vehicles(
    @CurrentSession() current: AuthenticatedSession,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.listVehicles(current);
  }

  @Post('vehicles')
  @HttpCode(201)
  @RequireCsrf('driver.vehicle.create')
  async createVehicle(
    @CurrentSession() current: AuthenticatedSession,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.createVehicle(current, body);
  }

  @Put('vehicles/:vehicleId')
  @RequireCsrf('driver.vehicle.update')
  async updateVehicle(
    @CurrentSession() current: AuthenticatedSession,
    @Param('vehicleId') vehicleId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.updateVehicle(current, vehicleId, body);
  }

  @Get('ratings')
  async ratings(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.driverRatings(current, query);
  }

  @Get('assignments')
  async assignments(
    @CurrentSession() current: AuthenticatedSession,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.logistics.listDriverAssignments(current, query);
  }
}

@AuthenticatedOnly()
@Controller('deliveries')
export class DeliveryRatingsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Post(':deliveryId/rating')
  @HttpCode(201)
  @RequireCsrf('delivery.rating.create')
  async create(
    @CurrentSession() current: AuthenticatedSession,
    @Param('deliveryId') deliveryId: string,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ResponseLike,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    requireJson(contentType);
    return this.logistics.createDeliveryRating(current, deliveryId, body);
  }
}

function requireJson(contentType: string | undefined): void {
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
}

function requireIdempotencyKey(value: string | undefined): void {
  if (value === undefined || !/^[A-Za-z0-9._~-]{16,128}$/.test(value)) {
    throw problem(422, 'VALIDATION_FAILED', 'A valid Idempotency-Key is required');
  }
}
