import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Doctor inbox — the list of conversations with unread counts and latest
/// message timestamps (`GET /doctor/inbox`). Paginated by cursor.
final doctorInboxProvider =
    FutureProvider.family<ConversationInboxList, String?>((ref, cursor) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.doctorInbox,
      queryParameters: cleanQuery({'cursor': cursor}),
    );
    return decodeConversationInboxList(body);
  });
});

/// Messages in a conversation (`GET /conversations/{id}/messages`), paginated.
final conversationMessagesProvider =
    FutureProvider.family<MessageList, (String, String?)>(
        (ref, params) async {
  final api = ref.watch(apiClientProvider);
  final (conversationId, cursor) = params;
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.conversationMessages(conversationId),
      queryParameters: cleanQuery({'cursor': cursor}),
    );
    return decodeMessageList(body);
  });
});

/// Outcome of sending a message.
class SendMessageState {
  const SendMessageState({this.value, this.error, this.loading = false});
  final Message? value;
  final ApiError? error;
  final bool loading;
}

/// Send a text message to a conversation (`POST /conversations/{id}/messages`).
/// The `clientCorrelationId` is the app-side dedup id; the Idempotency-Key is
/// added automatically by the API client.
class SendMessageNotifier extends StateNotifier<SendMessageState> {
  SendMessageNotifier(this._api) : super(const SendMessageState());
  final ApiClient _api;

  Future<bool> call({
    required String conversationId,
    required String clientCorrelationId,
    String? textContent,
    String? fileObjectId,
  }) async {
    state = const SendMessageState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.conversationMessages(conversationId),
        body: <String, dynamic>{
          'message_type': MessageType.text.wireValue,
          if (textContent != null) 'text_content': textContent,
          if (fileObjectId != null) 'file_object_id': fileObjectId,
          'client_correlation_id': clientCorrelationId,
        },
      );
      state = SendMessageState(value: decodeMessage(body));
      return true;
    } catch (e) {
      state = SendMessageState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const SendMessageState();
}

final sendMessageProvider = StateNotifierProvider.autoDispose<
    SendMessageNotifier, SendMessageState>(
    (ref) => SendMessageNotifier(ref.watch(apiClientProvider)));

/// Mark a conversation as read up to a sequence number
/// (`PUT /conversations/{id}/read`).
Future<MarkConversationReadResult> markConversationRead(
  WidgetRef ref, {
  required String conversationId,
  required int throughSequenceNo,
}) async {
  final api = ref.read(apiClientProvider);
  final body = await api.put(
    ApiEndpoints.conversationRead(conversationId),
    body: <String, dynamic>{'through_sequence_no': throughSequenceNo},
  );
  return MarkConversationReadResult(
    updatedReceipts: (body['updated_receipts'] as num?)?.toInt() ?? 0,
    throughSequenceNo: (body['through_sequence_no'] as num?)?.toInt() ?? throughSequenceNo,
  );
}
