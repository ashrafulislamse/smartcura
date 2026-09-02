import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Filter for the notifications list. `category` carries a
/// [NotificationCategory] wire value; `unread` requests only unread items.
class NotificationFilter {
  const NotificationFilter({this.category, this.unread, this.cursor});
  final String? category; // wire value of [NotificationCategory]
  final bool? unread;
  final String? cursor;
}

/// Notifications list (`GET /notifications`). Filter by an optional category
/// and cursor; only unread can be requested with `unread=true`.
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

/// Outcome of a mark-read mutation.
class MarkNotificationReadState {
  const MarkNotificationReadState({this.error, this.loading = false});
  final ApiError? error;
  final bool loading;
}

/// Mark a single notification as read (`PUT /notifications/{id}/read`).
class MarkNotificationReadNotifier
    extends StateNotifier<MarkNotificationReadState> {
  MarkNotificationReadNotifier(this._api)
      : super(const MarkNotificationReadState());
  final ApiClient _api;

  Future<bool> call({required String notificationId}) async {
    state = const MarkNotificationReadState(loading: true);
    try {
      await _api.put(ApiEndpoints.notificationRead(notificationId));
      state = const MarkNotificationReadState();
      return true;
    } catch (e) {
      state = MarkNotificationReadState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const MarkNotificationReadState();
}

final markNotificationReadNotifier = StateNotifierProvider.autoDispose<
    MarkNotificationReadNotifier, MarkNotificationReadState>(
    (ref) => MarkNotificationReadNotifier(ref.watch(apiClientProvider)));

/// Outcome of the mark-all-read mutation.
class MarkAllNotificationsReadState {
  const MarkAllNotificationsReadState({this.error, this.loading = false});
  final ApiError? error;
  final bool loading;
}

/// Mark every notification as read (`PUT /notifications/read-all`).
class MarkAllNotificationsReadNotifier
    extends StateNotifier<MarkAllNotificationsReadState> {
  MarkAllNotificationsReadNotifier(this._api)
      : super(const MarkAllNotificationsReadState());
  final ApiClient _api;

  Future<bool> call() async {
    state = const MarkAllNotificationsReadState(loading: true);
    try {
      await _api.put(ApiEndpoints.notificationsReadAll);
      state = const MarkAllNotificationsReadState();
      return true;
    } catch (e) {
      state = MarkAllNotificationsReadState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const MarkAllNotificationsReadState();
}

final markAllNotificationsReadNotifier = StateNotifierProvider.autoDispose<
    MarkAllNotificationsReadNotifier, MarkAllNotificationsReadState>(
    (ref) => MarkAllNotificationsReadNotifier(ref.watch(apiClientProvider)));

/// Notification preferences for the current profile
/// (`GET /notifications/preferences/me`).
final notificationPreferencesProvider =
    FutureProvider<NotificationPreferenceList>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.notificationPreferences);
    return decodeNotificationPreferenceList(body);
  });
});
