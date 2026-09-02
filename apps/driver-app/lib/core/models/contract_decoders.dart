// JSON decoders for the generated [smartcura_contracts] types.
//
// The contracts package ships plain `const`-constructor classes with no
// `fromJson`/`toJson`, so this file is the single place that maps the backend's
// snake_case JSON onto those types. Enum wire values are parsed through the
// generated `*FromWire` functions. Money is always integer sen — never parsed
// as a double and never formatted here.
import 'package:smartcura_contracts/smartcura_contracts.dart';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

int _i(Map<String, dynamic> j, String k, [int fallback = 0]) =>
    (j[k] as num?)?.toInt() ?? fallback;

int? _iN(Map<String, dynamic> j, String k) => (j[k] as num?)?.toInt();

double? _dN(Map<String, dynamic> j, String k) => (j[k] as num?)?.toDouble();

String _s(Map<String, dynamic> j, String k, [String fallback = '']) =>
    (j[k] as String?) ?? fallback;

String? _sN(Map<String, dynamic> j, String k) => j[k] as String?;

bool _b(Map<String, dynamic> j, String k, [bool fallback = false]) =>
    (j[k] as bool?) ?? fallback;

Map<String, dynamic> _o(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v is Map<String, dynamic> ? v : <String, dynamic>{};
}

List<Map<String, dynamic>> _list(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is List) {
    return v.whereType<Map<String, dynamic>>().toList();
  }
  return <Map<String, dynamic>>[];
}

List<String> _strList(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is List) return v.whereType<String>().toList();
  return <String>[];
}

List<UuidV7> _uuidList(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is List) return v.whereType<String>().toList();
  return <UuidV7>[];
}

// ---------------------------------------------------------------------------
// Session / auth
// ---------------------------------------------------------------------------

Profile decodeProfile(Map<String, dynamic> j) => Profile(
      id: _s(j, 'id'),
      status: profileStatusFromWire(_s(j, 'status')),
      displayName: _s(j, 'display_name'),
      email: _s(j, 'email'),
      phoneE164: _sN(j, 'phone_e164'),
      preferredLocale: _s(j, 'preferred_locale'),
      timezone: _s(j, 'timezone'),
      onboardingCompletedAt: _sN(j, 'onboarding_completed_at'),
      avatarUrl: _sN(j, 'avatar_url'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

Membership decodeMembership(Map<String, dynamic> j) => Membership(
      id: _s(j, 'id'),
      organizationId: _s(j, 'organization_id'),
      siteIds: _uuidList(j, 'site_ids'),
      role: roleIdFromWire(_s(j, 'role')),
      status: membershipStatusFromWire(_s(j, 'status')),
      verificationStatus: _sN(j, 'verification_status') == null
          ? null
          : verificationStatusFromWire(_sN(j, 'verification_status')!),
      permissions: _strList(j, 'permissions'),
    );

SessionView decodeSessionView(Map<String, dynamic> j) => SessionView(
      id: _s(j, 'id'),
      status: appSessionStatusFromWire(_s(j, 'status')),
      profileId: _s(j, 'profile_id'),
      activeRole: _sN(j, 'active_role') == null
          ? null
          : roleIdFromWire(_sN(j, 'active_role')!),
      createdAt: _s(j, 'created_at'),
      lastActivityAt: _s(j, 'last_activity_at'),
      idleExpiresAt: _s(j, 'idle_expires_at'),
      absoluteExpiresAt: _s(j, 'absolute_expires_at'),
      stepUpValidUntil: _sN(j, 'step_up_valid_until'),
    );

SessionBootstrapResponse decodeSessionBootstrap(Map<String, dynamic> j) =>
    SessionBootstrapResponse(
      bootstrapState: bootstrapStateFromWire(_s(j, 'bootstrap_state')),
      csrfToken: _s(j, 'csrf_token'),
      profile: decodeProfile(_o(j, 'profile')),
      memberships: _list(j, 'memberships').map(decodeMembership).toList(),
      session: decodeSessionView(_o(j, 'session')),
    );

StepUpResponse decodeStepUpResponse(Map<String, dynamic> j) => StepUpResponse(
      sessionId: _s(j, 'session_id'),
      validUntil: _s(j, 'valid_until'),
      csrfToken: _s(j, 'csrf_token'),
    );

// ---------------------------------------------------------------------------
// PageInfo + generic list bodies
// ---------------------------------------------------------------------------

PageInfo decodePageInfo(Map<String, dynamic> j) => PageInfo(
      hasMore: _b(j, 'has_more'),
      nextCursor: _sN(j, 'next_cursor'),
    );

/// Extracts the `page` object from a list response, defaulting to "no more".
PageInfo pageFromListBody(Map<String, dynamic> j) {
  final p = j['page'];
  return p is Map<String, dynamic>
      ? decodePageInfo(p)
      : const PageInfo(hasMore: false, nextCursor: null);
}

// ---------------------------------------------------------------------------
// Dispatch - offers
// ---------------------------------------------------------------------------

DispatchOfferSummary decodeDispatchOfferSummary(Map<String, dynamic> j) =>
    DispatchOfferSummary(
      offerId: _s(j, 'offer_id'),
      dispatchJobId: _s(j, 'dispatch_job_id'),
      feeSen: _i(j, 'fee_sen'),
      currency: _s(j, 'currency'),
      approxDistanceMetres: _iN(j, 'approx_distance_metres'),
      expiresAt: _s(j, 'expires_at'),
      version: _i(j, 'version'),
    );

DispatchOfferList decodeDispatchOfferList(Map<String, dynamic> j) =>
    DispatchOfferList(
      data: _list(j, 'data').map(decodeDispatchOfferSummary).toList(),
    );

// ---------------------------------------------------------------------------
// Dispatch - assignments
// ---------------------------------------------------------------------------

DispatchAssignmentCreated decodeDispatchAssignmentCreated(
        Map<String, dynamic> j) =>
    DispatchAssignmentCreated(
      assignmentId: _s(j, 'assignment_id'),
      dispatchJobId: _s(j, 'dispatch_job_id'),
      status: _s(j, 'status'),
      version: _i(j, 'version'),
    );

DispatchAssignmentState decodeDispatchAssignmentState(Map<String, dynamic> j) =>
    DispatchAssignmentState(
      assignmentId: _s(j, 'assignment_id'),
      status: dispatchAssignmentStatusFromWire(_s(j, 'status')),
      version: _i(j, 'version'),
    );

/// Decodes a single dispatch assignment from `GET /dispatch/assignments/{id}`.
DispatchAssignmentSummary decodeDispatchAssignmentSummary(
        Map<String, dynamic> j) =>
    DispatchAssignmentSummary.fromJson(j);

/// Decodes a list of driver assignments from `GET /drivers/me/assignments`.
///
/// Uses the dedicated [DispatchAssignmentSummary] type which carries
/// assignment_id, dispatch_job_id, status, assigned_at, completed_at, fee_sen,
/// and version.
DispatchAssignmentList decodeDriverAssignmentList(Map<String, dynamic> j) =>
    DispatchAssignmentList.fromJson(j);

/// Convenience: decode just the `data` array from a driver assignments response.
List<DispatchAssignmentSummary> decodeDriverAssignmentSummaries(
        Map<String, dynamic> j) =>
    (j['data'] as List)
        .map((e) =>
            DispatchAssignmentSummary.fromJson(e as Map<String, Object?>))
        .toList();

// ---------------------------------------------------------------------------
// Recipient disclosure
// ---------------------------------------------------------------------------

RecipientDisclosure decodeRecipientDisclosure(Map<String, dynamic> j) =>
    RecipientDisclosure(
      deliveryId: _s(j, 'delivery_id'),
      recipientName: _s(j, 'recipient_name'),
      recipientPhoneE164: _s(j, 'recipient_phone_e164'),
      addressLine1: _s(j, 'address_line1'),
      addressLine2: _sN(j, 'address_line2'),
      postcode: _s(j, 'postcode'),
      city: _s(j, 'city'),
      stateCode: _s(j, 'state_code'),
    );

// ---------------------------------------------------------------------------
// Assignment stops (navigation coordinates)
// ---------------------------------------------------------------------------

/// Decodes `GET /dispatch/assignments/{id}/stops`: ordered pickup/dropoff
/// coordinates, disclosed only while the driver holds an active assignment.
DispatchAssignmentStops decodeDispatchAssignmentStops(Map<String, dynamic> j) =>
    DispatchAssignmentStops.fromJson(j);

// ---------------------------------------------------------------------------
// Driver earnings
// ---------------------------------------------------------------------------

DriverEarnings decodeDriverEarnings(Map<String, dynamic> j) => DriverEarnings(
      driverId: _s(j, 'driver_id'),
      currency: _s(j, 'currency'),
      balanceSen: _i(j, 'balance_sen'),
    );

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

Vehicle decodeVehicle(Map<String, dynamic> j) => Vehicle(
      vehicleId: _s(j, 'vehicle_id'),
      plateNumber: _s(j, 'plate_number'),
      vehicleType: _s(j, 'vehicle_type'),
      active: _b(j, 'active'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

VehicleList decodeVehicleList(Map<String, dynamic> j) => VehicleList(
      data: _list(j, 'data').map(decodeVehicle).toList(),
    );

// ---------------------------------------------------------------------------
// Delivery ratings
// ---------------------------------------------------------------------------

DeliveryRating decodeDeliveryRating(Map<String, dynamic> j) => DeliveryRating(
      ratingId: _s(j, 'rating_id'),
      deliveryId: _s(j, 'delivery_id'),
      stars: _i(j, 'stars'),
      createdAt: _s(j, 'created_at'),
    );

DriverRatingList decodeDriverRatingList(Map<String, dynamic> j) =>
    DriverRatingList(
      driverId: _s(j, 'driver_id'),
      averageStars: _dN(j, 'average_stars'),
      totalRatings: _i(j, 'total_ratings'),
      data: _list(j, 'data').map(decodeDeliveryRating).toList(),
    );

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------

WithdrawalRequested decodeWithdrawalRequested(Map<String, dynamic> j) =>
    WithdrawalRequested(
      withdrawalId: _s(j, 'withdrawal_id'),
      status: _s(j, 'status'),
      remainingSen: _i(j, 'remaining_sen'),
    );

BankAccountRegistered decodeBankAccountRegistered(Map<String, dynamic> j) =>
    BankAccountRegistered(
      bankAccountId: _s(j, 'bank_account_id'),
      accountLast4: _s(j, 'account_last4'),
    );

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

Notification decodeNotification(Map<String, dynamic> j) => Notification(
      notificationId: _s(j, 'notification_id'),
      category: notificationCategoryFromWire(_s(j, 'category')),
      resourceType: _s(j, 'resource_type'),
      resourceId: _s(j, 'resource_id'),
      titleCode: _s(j, 'title_code'),
      bodyCode: _s(j, 'body_code'),
      priority: notificationPriorityFromWire(_s(j, 'priority')),
      expiresAt: _s(j, 'expires_at'),
      readAt: _sN(j, 'read_at'),
      createdAt: _s(j, 'created_at'),
    );

NotificationList decodeNotificationList(Map<String, dynamic> j) =>
    NotificationList(
      data: _list(j, 'data').map(decodeNotification).toList(),
      page: pageFromListBody(j),
    );

NotificationPreference decodeNotificationPreference(Map<String, dynamic> j) =>
    NotificationPreference(
      category: notificationCategoryFromWire(_s(j, 'category')),
      channel: _s(j, 'channel'),
      enabled: _b(j, 'enabled'),
      quietHoursStart: _sN(j, 'quiet_hours_start'),
      quietHoursEnd: _sN(j, 'quiet_hours_end'),
      timezone: _s(j, 'timezone'),
    );

NotificationPreferenceList decodeNotificationPreferenceList(
        Map<String, dynamic> j) =>
    NotificationPreferenceList(
      data: _list(j, 'data').map(decodeNotificationPreference).toList(),
    );
