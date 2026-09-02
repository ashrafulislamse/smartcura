import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// No direct mock replacement — notifications were previously UI-only.
//
// Screens that must be updated in Phase 2:
//   - lib/features/home/presentation/screens/notifications_screen.dart
//   - lib/features/profile/presentation/screens/notification_preferences_screen.dart

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

class NotificationMapper {
  static Notification fromJson(Map<String, dynamic> j) => Notification(
        // Backend may send null for fields the client never writes; coerce to
        // safe defaults so one malformed row doesn't crash the whole list.
        notificationId: (j['notification_id'] as String?) ?? '',
        category:
            notificationCategoryFromWire((j['category'] as String?) ?? ''),
        resourceType: (j['resource_type'] as String?) ?? '',
        resourceId: (j['resource_id'] as String?) ?? '',
        titleCode: (j['title_code'] as String?) ?? '',
        bodyCode: (j['body_code'] as String?) ?? '',
        priority:
            notificationPriorityFromWire((j['priority'] as String?) ?? ''),
        // The wire allows null (`expires_at: ... ?? null`) while the
        // generated model types the field non-nullable; nothing in the app
        // reads it, so an absent value renders as an empty string instead of
        // crashing the whole list.
        expiresAt: j['expires_at'] as String? ?? '',
        readAt: j['read_at'] as String?,
        createdAt: (j['created_at'] as String?) ?? '',
      );
}

class NotificationListMapper {
  static List<Notification> fromJson(Map<String, dynamic> j) =>
      (j['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map(NotificationMapper.fromJson)
          .toList();
}

class NotificationPreferenceMapper {
  static NotificationPreference fromJson(Map<String, dynamic> j) =>
      NotificationPreference(
        category: notificationCategoryFromWire(j['category'] as String),
        channel: j['channel'] as String,
        enabled: j['enabled'] as bool? ?? false,
        quietHoursStart: j['quiet_hours_start'] as String?,
        quietHoursEnd: j['quiet_hours_end'] as String?,
        timezone: j['timezone'] as String,
      );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// Filter for [notificationsProvider]; each field maps straight onto a
/// `GET /notifications` query parameter (`category=`, `unread=`), so filtering
/// happens server-side instead of over-fetching and hiding rows client-side.
typedef NotificationFilter = ({
  NotificationCategory? category,
  bool unreadOnly
});

/// The unfiltered list (all categories, read and unread).
const NotificationFilter allNotifications = (category: null, unreadOnly: false);

/// Notifications for the current patient.
/// Backend: GET /notifications?category=&unread=
final notificationsProvider =
    FutureProvider.family<List<Notification>, NotificationFilter>(
        (ref, filter) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get<dynamic>(
    ApiEndpoints.notifications,
    queryParameters: <String, dynamic>{
      if (filter.category != null) 'category': filter.category!.wireValue,
      'unread': filter.unreadOnly ? 'true' : 'false',
    },
  );
  return NotificationListMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Mark a single notification as read.
/// Backend: PUT /notifications/{id}/read
Future<void> markNotificationRead(Ref ref, String notificationId) async {
  final dio = ref.read(apiClientProvider);
  await dio.put<void>(ApiEndpoints.notificationRead(notificationId));
  ref.invalidate(notificationsProvider);
}

/// Mark every unread notification as read in one request.
/// Backend: PUT /notifications/read-all (responds `{"updated": n}`).
Future<void> markAllNotificationsRead(Ref ref) async {
  final dio = ref.read(apiClientProvider);
  await dio.put<void>(ApiEndpoints.notificationsReadAll);
  ref.invalidate(notificationsProvider);
}

/// Notification preferences for the current patient.
/// Backend: GET /notifications/preferences/me
final notificationPreferencesProvider =
    FutureProvider<List<NotificationPreference>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.notificationPreferences);
  final data = response.data;
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(NotificationPreferenceMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(NotificationPreferenceMapper.fromJson)
      .toList();
});

/// Register a push device token (FCM token from firebase_messaging).
/// Backend: POST /notifications/push-devices
final registerPushDeviceProvider =
    FutureProvider.family<void, ({String platform, String token})>(
        (ref, params) async {
  final dio = ref.watch(apiClientProvider);
  await dio.post(
    ApiEndpoints.pushDevices,
    data: {
      'platform': params.platform,
      'token': params.token,
    },
  );
});

/// Update a single notification preference (PUT /notifications/preferences/me).
///
/// The backend accepts a preference object keyed by `category` + `channel`.
/// Call this from a toggle's `onChanged` to persist immediately.
/// Accepts [WidgetRef] so it can be called directly from ConsumerState widgets.
Future<void> updateNotificationPreferences(
  WidgetRef ref, {
  required String category,
  required String channel,
  required bool enabled,
  String? quietHoursStart,
  String? quietHoursEnd,
}) async {
  final dio = ref.read(apiClientProvider);
  await dio.put(
    '${ApiEndpoints.notificationPreferences}/$category/$channel',
    data: {
      'enabled': enabled,
      if (quietHoursStart != null) 'quiet_hours_start': quietHoursStart,
      if (quietHoursEnd != null) 'quiet_hours_end': quietHoursEnd,
    },
  );
  ref.invalidate(notificationPreferencesProvider);
}

/// Bulk update notification preferences. The backend accepts a list of
/// preference objects. Used by the Save button on the preferences screen.
/// Backend: PUT /notifications/preferences/me
final updateNotificationPreferencesProvider = StateNotifierProvider<
    UpdateNotificationPreferencesNotifier,
    AsyncValue<void>>((ref) => UpdateNotificationPreferencesNotifier(ref));

class UpdateNotificationPreferencesNotifier
    extends StateNotifier<AsyncValue<void>> {
  final Ref _ref;
  UpdateNotificationPreferencesNotifier(this._ref)
      : super(const AsyncValue.data(null));

  Future<void> bulkUpdate(List<NotificationPreference> preferences) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.put(
        ApiEndpoints.notificationPreferences,
        data: {
          'data': preferences
              .map((p) => {
                    'category': p.category.wireValue,
                    'channel': p.channel,
                    'enabled': p.enabled,
                    if (p.quietHoursStart != null)
                      'quiet_hours_start': p.quietHoursStart,
                    if (p.quietHoursEnd != null)
                      'quiet_hours_end': p.quietHoursEnd,
                  })
              .toList(),
        },
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(notificationPreferencesProvider);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
    }
  }
}

/// Create a support ticket.
/// Backend: POST /support/tickets
final createSupportTicketProvider = StateNotifierProvider<
        CreateSupportTicketNotifier, AsyncValue<SupportTicketCreated?>>(
    (ref) => CreateSupportTicketNotifier(ref));

class CreateSupportTicketNotifier
    extends StateNotifier<AsyncValue<SupportTicketCreated?>> {
  final Ref _ref;
  CreateSupportTicketNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<SupportTicketCreated?> create({
    required String organizationId,
    required String categoryCode,
    required String subjectCode,
    String? priority,
    required String body,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.post(
        ApiEndpoints.supportTickets,
        data: {
          'organization_id': organizationId,
          'category_code': categoryCode,
          'subject_code': subjectCode,
          if (priority != null) 'priority': priority,
          'body': body,
        },
      );
      final created = SupportTicketCreated(
        supportTicketId: response.data['support_ticket_id'] as String,
        status: response.data['status'] as String,
      );
      state = AsyncValue.data(created);
      return created;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
      return null;
    }
  }
}
