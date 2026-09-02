import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Notifications list (`GET /notifications`). Filter by an optional category
/// and cursor; only unread can be requested with `unread=true`.
class NotificationFilter {
  const NotificationFilter({this.category, this.unread, this.cursor});
  final String? category; // wire value of [NotificationCategory]
  final bool? unread;
  final String? cursor;
}

final notificationsProvider =
    FutureProvider.family<NotificationList, NotificationFilter>(
        (ref, filter) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.notifications,
      queryParameters: cleanQuery({
        'category': filter.category,
        'unread': filter.unread == true ? 'true' : null,
        'cursor': filter.cursor,
      }),
    );
    return decodeNotificationList(body);
  });
});

/// Mark a single notification as read (`PUT /notifications/{id}/read`).
Future<void> markNotificationRead(
  WidgetRef ref, {
  required String notificationId,
}) async {
  final api = ref.read(apiClientProvider);
  await api.put(ApiEndpoints.notificationRead(notificationId));
}

/// Mark every notification read (`PUT /notifications/read-all`). Returns the
/// server-reported count of updated rows.
Future<int> markAllNotificationsRead(WidgetRef ref) async {
  final api = ref.read(apiClientProvider);
  final body = await api.put(ApiEndpoints.notificationsReadAll);
  return (body['updated'] as num?)?.toInt() ?? 0;
}

/// Notification preferences for the current profile (`GET /notifications/preferences/me`).
final notificationPreferencesProvider =
    FutureProvider<NotificationPreferenceList>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.notificationPreferences);
    return decodeNotificationPreferenceList(body);
  });
});

/// Outcome of updating notification preferences.
class PreferencesMutationState {
  const PreferencesMutationState({this.value, this.error, this.loading = false});
  final NotificationPreferenceList? value;
  final ApiError? error;
  final bool loading;
}

/// Replace the full notification-preference set (`PUT /notifications/preferences/me`).
class UpdatePreferencesNotifier extends StateNotifier<PreferencesMutationState> {
  UpdatePreferencesNotifier(this._api) : super(const PreferencesMutationState());
  final ApiClient _api;

  Future<bool> call(List<NotificationPreference> prefs) async {
    state = const PreferencesMutationState(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.notificationPreferences,
        body: <String, dynamic>{
          'data': prefs
              .map((p) => <String, dynamic>{
                    'category': p.category.wireValue,
                    'channel': p.channel,
                    'enabled': p.enabled,
                    if (p.quietHoursStart != null)
                      'quiet_hours_start': p.quietHoursStart,
                    if (p.quietHoursEnd != null) 'quiet_hours_end': p.quietHoursEnd,
                    'timezone': p.timezone,
                  })
              .toList(),
        },
      );
      state = PreferencesMutationState(
          value: decodeNotificationPreferenceList(body));
      return true;
    } catch (e) {
      state = PreferencesMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const PreferencesMutationState();
}

final updatePreferencesProvider = StateNotifierProvider.autoDispose<
    UpdatePreferencesNotifier, PreferencesMutationState>(
    (ref) => UpdatePreferencesNotifier(ref.watch(apiClientProvider)));
