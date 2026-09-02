import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:uuid/uuid.dart';

import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

class ConsultationMapper {
  static Consultation fromJson(Map<String, dynamic> j) => Consultation(
        consultationId: j['consultation_id'] as String,
        appointmentId: j['appointment_id'] as String,
        organizationId: j['organization_id'] as String,
        patientProfileId: j['patient_profile_id'] as String,
        doctorMembershipId: j['doctor_membership_id'] as String,
        status: consultationStatusFromWire(j['status'] as String),
        outcomeCode: j['outcome_code'] as String?,
        version: (j['version'] as num).toInt(),
        startedAt: j['started_at'] as String?,
        completedAt: j['completed_at'] as String?,
        createdAt: j['created_at'] as String,
        updatedAt: j['updated_at'] as String,
      );
}

class ConsultationListMapper {
  static List<Consultation> fromJson(Map<String, dynamic> j) =>
      (j['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map(ConsultationMapper.fromJson)
          .toList();
}

class ConversationMapper {
  static Conversation fromJson(Map<String, dynamic> j) => Conversation(
        conversationId: j['conversation_id'] as String,
        consultationId: j['consultation_id'] as String,
        status: j['status'] as String,
      );
}

class MessageMapper {
  static Message fromJson(Map<String, dynamic> j) => Message(
        messageId: j['message_id'] as String,
        conversationId: j['conversation_id'] as String,
        senderProfileId: j['sender_profile_id'] as String,
        sequenceNo: (j['sequence_no'] as num).toInt(),
        clientCorrelationId: j['client_correlation_id'] as String? ?? '',
        messageType: messageTypeFromWire(j['message_type'] as String),
        textContent: j['text_content'] as String?,
        fileObjectId: j['file_object_id'] as String?,
        isMe: j['is_me'] as bool? ?? false,
        deliveredAt: j['delivered_at'] as String?,
        readAt: j['read_at'] as String?,
        createdAt: j['created_at'] as String,
      );
}

class MessageListMapper {
  static List<Message> fromJson(Map<String, dynamic> j) =>
      (j['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map(MessageMapper.fromJson)
          .toList();
}

// ---------------------------------------------------------------------------
// Patient-scoped conversation providers
// ---------------------------------------------------------------------------

/// A consultation paired with its resolved conversation, for the Messages list.
class PatientConversationEntry {
  final Consultation consultation;
  final Conversation conversation;

  const PatientConversationEntry({
    required this.consultation,
    required this.conversation,
  });
}

/// The current patient's consultations.
/// Backend: GET /profiles/me/consultations
///
/// A 404 is treated as an empty list. This can happen when the patient-self
/// route is temporarily unavailable or when the patient has no consultations
/// and the backend returns a route-level 404 instead of an empty page. The
/// Messages tab should degrade to an empty state rather than surfacing a 404
/// overlay.
final patientConsultationsProvider =
    FutureProvider<List<Consultation>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  try {
    final response =
        await dio.get<dynamic>(ApiEndpoints.profilesMeConsultations);
    final data = response.data;
    if (data is List) {
      return data
          .whereType<Map<String, dynamic>>()
          .map(ConsultationMapper.fromJson)
          .toList();
    }
    return ConsultationListMapper.fromJson(data as Map<String, dynamic>);
  } on DioException catch (e) {
    final apiError = e.error as ApiError?;
    if (apiError?.isNotFound == true) return const <Consultation>[];
    rethrow;
  }
});

/// Resolve the conversation for a single consultation.
/// Backend: GET /consultations/{id}/conversation
final consultationConversationProvider =
    FutureProvider.family<Conversation, String>((ref, consultationId) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio
      .get<dynamic>(ApiEndpoints.consultationConversation(consultationId));
  return ConversationMapper.fromJson(response.data as Map<String, dynamic>);
});

/// All conversations for the current patient, resolved through consultations.
///
/// Combines [patientConsultationsProvider] with per-consultation conversation
/// resolution to produce a list of [PatientConversationEntry] objects.
///
/// Consultations without a conversation (404) are silently skipped — a
/// consultation may exist before the conversation is created. Any other
/// failure for a single conversation is also skipped so one bad consultation
/// cannot break the entire Messages tab.
final patientConversationsProvider =
    FutureProvider<List<PatientConversationEntry>>((ref) async {
  final consultations = await ref.watch(patientConsultationsProvider.future);
  final dio = ref.watch(apiClientProvider);

  final entries = <PatientConversationEntry>[];
  for (final consultation in consultations) {
    try {
      final response = await dio.get<dynamic>(
          ApiEndpoints.consultationConversation(consultation.consultationId));
      final conversation =
          ConversationMapper.fromJson(response.data as Map<String, dynamic>);
      entries.add(PatientConversationEntry(
        consultation: consultation,
        conversation: conversation,
      ));
    } on DioException catch (e) {
      // 404 = conversation not created yet — skip silently.
      final apiError = e.error as ApiError?;
      if (apiError?.isNotFound == true) continue;
      // Swallow other conversation-level errors so one consultation cannot
      // break the whole list. The individual chat screen will still show its
      // own error if the user taps through.
      continue;
    } on Object catch (_) {
      // Defensive: a non-Dio failure should not crash the list either.
      continue;
    }
  }
  return entries;
});

/// Backward-compatible alias — returns just the conversation objects.
final conversationsProvider = FutureProvider<List<Conversation>>((ref) async {
  final entries = await ref.watch(patientConversationsProvider.future);
  return entries.map((e) => e.conversation).toList();
});

/// Total unread incoming messages across all of the patient's conversations.
///
/// The patient conversation contract carries no unread counter (the doctor
/// inbox does), so the badge is derived from the message pages: incoming
/// messages (`is_me == false`) without a `read_at`. A failed fetch yields 0
/// rather than an error so the bottom-nav badge degrades to "no badge"
/// instead of surfacing a stack trace in the shell.
final patientUnreadMessageCountProvider = FutureProvider<int>((ref) async {
  final entries = await ref.watch(patientConversationsProvider.future);
  final dio = ref.watch(apiClientProvider);
  var total = 0;
  for (final entry in entries) {
    try {
      final response = await dio.get<dynamic>(
        ApiEndpoints.conversationMessages(entry.conversation.conversationId),
        queryParameters: {'page_size': 100},
      );
      final messages =
          MessageListMapper.fromJson(response.data as Map<String, dynamic>);
      total += messages.where((m) => !m.isMe && m.readAt == null).length;
    } on DioException {
      // One unreadable conversation must not erase the others' badges.
      continue;
    }
  }
  return total;
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/// Messages in a conversation (paginated).
/// Backend: GET /conversations/{id}/messages
final conversationMessagesProvider =
    FutureProvider.family<List<Message>, String>((ref, conversationId) async {
  final dio = ref.watch(apiClientProvider);
  final response =
      await dio.get<dynamic>(ApiEndpoints.conversationMessages(conversationId));
  return MessageListMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Send a text message and invalidate the conversation's message list.
/// Backend: POST /conversations/{id}/messages
final sendMessageProvider =
    StateNotifierProvider<SendMessageNotifier, AsyncValue<Message?>>(
        (ref) => SendMessageNotifier(ref));

class SendMessageNotifier extends StateNotifier<AsyncValue<Message?>> {
  final Ref _ref;
  final _uuid = const Uuid();

  SendMessageNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<Message?> sendText({
    required String conversationId,
    required String text,
  }) async {
    state = const AsyncValue.loading();
    final correlationId = _uuid.v7();
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.post<dynamic>(
        ApiEndpoints.conversationMessages(conversationId),
        data: {
          'message_type': 'text',
          'text_content': text,
          'client_correlation_id': correlationId,
        },
      );
      final message =
          MessageMapper.fromJson(response.data as Map<String, dynamic>);
      state = AsyncValue.data(message);
      _ref.invalidate(conversationMessagesProvider(conversationId));
      return message;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? 'Request failed'),
          StackTrace.current);
      return null;
    }
  }
}

/// Mark a conversation as read through a given sequence number.
/// Backend: PUT /conversations/{id}/read
final markConversationReadProvider = FutureProvider.family<void,
    ({String conversationId, int throughSequenceNo})>((ref, params) async {
  final dio = ref.watch(apiClientProvider);
  await dio.put<dynamic>(
    ApiEndpoints.conversationRead(params.conversationId),
    data: {'through_sequence_no': params.throughSequenceNo},
  );
  ref.invalidate(patientConversationsProvider);
});
