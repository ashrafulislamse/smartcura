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

double _d(Map<String, dynamic> j, String k, [double fallback = 0]) =>
    (j[k] as num?)?.toDouble() ?? fallback;

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

Map<String, Object?> _obj(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is Map) return Map<String, Object?>.from(v);
  return <String, Object?>{};
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
// Dashboard
// ---------------------------------------------------------------------------

DoctorUpcomingAppointment decodeDoctorUpcomingAppointment(
        Map<String, dynamic> j) =>
    DoctorUpcomingAppointment(
      appointmentId: _s(j, 'appointment_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      startsAt: _s(j, 'starts_at'),
      status: _s(j, 'status'),
      mode: _s(j, 'mode'),
    );

DoctorDashboardGroups decodeDoctorDashboardGroups(Map<String, dynamic> j) =>
    DoctorDashboardGroups(
      todayAppointments: _iN(j, 'today_appointments'),
      upcomingAppointments: _list(j, 'upcoming_appointments')
          .map(decodeDoctorUpcomingAppointment)
          .toList(),
      assignedPatients: _iN(j, 'assigned_patients'),
      pendingNotes: _iN(j, 'pending_notes'),
      unreadNotifications: _iN(j, 'unread_notifications'),
      activeIotAlerts: _iN(j, 'active_iot_alerts'),
    );

DoctorDashboardResponse decodeDoctorDashboardResponse(Map<String, dynamic> j) =>
    DoctorDashboardResponse(
      data: decodeDoctorDashboardGroups(_o(j, 'data')),
      readableGroups: _strList(j, 'readable_groups'),
    );

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

AppointmentStatusCount decodeAppointmentStatusCount(Map<String, dynamic> j) =>
    AppointmentStatusCount(
      status: _s(j, 'status'),
      count: _i(j, 'count'),
    );

PatientCountPoint decodePatientCountPoint(Map<String, dynamic> j) =>
    PatientCountPoint(
      periodStart: _s(j, 'period_start'),
      periodEnd: _s(j, 'period_end'),
      count: _i(j, 'count'),
    );

DoctorRatingSummary decodeDoctorRatingSummary(Map<String, dynamic> j) =>
    DoctorRatingSummary(
      ratingAverage: _d(j, 'rating_average'),
      reviewCount: _i(j, 'review_count'),
    );

DoctorMonthlyEarningsProjection decodeDoctorMonthlyEarningsProjection(
        Map<String, dynamic> j) =>
    DoctorMonthlyEarningsProjection(
      projectedSen: _i(j, 'projected_sen'),
      currency: _s(j, 'currency'),
      periodStart: _s(j, 'period_start'),
      basisCount: _i(j, 'basis_count'),
    );

DoctorAnalyticsGroups decodeDoctorAnalyticsGroups(Map<String, dynamic> j) =>
    DoctorAnalyticsGroups(
      appointmentStatusBreakdown: _list(j, 'appointment_status_breakdown')
          .map(decodeAppointmentStatusCount)
          .toList(),
      patientCountTrend:
          _list(j, 'patient_count_trend').map(decodePatientCountPoint).toList(),
      ratingSummary: j['rating_summary'] is Map<String, dynamic>
          ? decodeDoctorRatingSummary(_o(j, 'rating_summary'))
          : null,
      monthlyEarningsProjection:
          j['monthly_earnings_projection'] is Map<String, dynamic>
              ? decodeDoctorMonthlyEarningsProjection(
                  _o(j, 'monthly_earnings_projection'))
              : null,
    );

DoctorAnalyticsResponse decodeDoctorAnalyticsResponse(Map<String, dynamic> j) =>
    DoctorAnalyticsResponse(
      data: decodeDoctorAnalyticsGroups(_o(j, 'data')),
      readableGroups: _strList(j, 'readable_groups'),
    );

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------

DoctorPayoutItem decodeDoctorPayoutItem(Map<String, dynamic> j) =>
    DoctorPayoutItem(
      id: _s(j, 'id'),
      payoutRunId: _s(j, 'payout_run_id'),
      grossSen: _i(j, 'gross_sen'),
      platformFeeSen: _i(j, 'platform_fee_sen'),
      netSen: _i(j, 'net_sen'),
      status: payoutItemStatusFromWire(_s(j, 'status')),
      ledgerEntryId: _sN(j, 'ledger_entry_id'),
      periodStart: _s(j, 'period_start'),
      periodEnd: _s(j, 'period_end'),
      runStatus: payoutRunStatusFromWire(_s(j, 'run_status')),
      createdAt: _s(j, 'created_at'),
    );

DoctorEarnings decodeDoctorEarnings(Map<String, dynamic> j) => DoctorEarnings(
      balanceSen: _i(j, 'balance_sen'),
      currency: _s(j, 'currency'),
      totalEarnedSen: _i(j, 'total_earned_sen'),
      data: _list(j, 'data').map(decodeDoctorPayoutItem).toList(),
      page: pageFromListBody(j),
    );

// ---------------------------------------------------------------------------
// Patients (doctor-assigned)
// ---------------------------------------------------------------------------

DoctorAssignedPatient decodeDoctorAssignedPatient(Map<String, dynamic> j) =>
    DoctorAssignedPatient(
      profileId: _s(j, 'profile_id'),
      displayName: _s(j, 'display_name'),
      email: _s(j, 'email'),
      phoneE164: _sN(j, 'phone_e164'),
      preferredLocale: _s(j, 'preferred_locale'),
      timezone: _s(j, 'timezone'),
      status: _s(j, 'status'),
      assignedAt: _s(j, 'assigned_at'),
    );

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

Appointment decodeAppointment(Map<String, dynamic> j) => Appointment(
      id: _s(j, 'id'),
      slotId: _s(j, 'slot_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      doctorMembershipId: _s(j, 'doctor_membership_id'),
      organizationId: _s(j, 'organization_id'),
      mode: appointmentModeFromWire(_s(j, 'mode')),
      status: appointmentStatusFromWire(_s(j, 'status')),
      startsAt: _s(j, 'starts_at'),
      endsAt: _s(j, 'ends_at'),
      feeSen: _i(j, 'fee_sen'),
      currency: _s(j, 'currency'),
      paymentState: _sN(j, 'payment_state') == null
          ? null
          : appointmentPaymentStateFromWire(_sN(j, 'payment_state')!),
      cancellationReasonCode: _sN(j, 'cancellation_reason_code') == null
          ? null
          : appointmentReasonCodeFromWire(_sN(j, 'cancellation_reason_code')!),
      replacedByAppointmentId: _sN(j, 'replaced_by_appointment_id'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

AppointmentListResponse decodeAppointmentListResponse(Map<String, dynamic> j) =>
    AppointmentListResponse(
      data: _list(j, 'data').map(decodeAppointment).toList(),
      page: pageFromListBody(j),
    );

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

AvailabilityRule decodeAvailabilityRule(Map<String, dynamic> j) =>
    AvailabilityRule(
      id: _s(j, 'id'),
      membershipId: _s(j, 'membership_id'),
      organizationId: _s(j, 'organization_id'),
      weekday: _i(j, 'weekday'),
      startTime: _s(j, 'start_time'),
      endTime: _s(j, 'end_time'),
      slotDurationMinutes: _i(j, 'slot_duration_minutes'),
      timezone: _s(j, 'timezone'),
      effectiveFrom: _s(j, 'effective_from'),
      effectiveTo: _sN(j, 'effective_to'),
      isActive: _b(j, 'is_active'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

AvailabilityRulesResponse decodeAvailabilityRulesResponse(
        Map<String, dynamic> j) =>
    AvailabilityRulesResponse(
      data: _list(j, 'data').map(decodeAvailabilityRule).toList(),
      version: _i(j, 'version'),
      generatedSlotCount: _i(j, 'generated_slot_count'),
    );

AvailabilityException decodeAvailabilityException(Map<String, dynamic> j) =>
    AvailabilityException(
      id: _s(j, 'id'),
      membershipId: _s(j, 'membership_id'),
      organizationId: _s(j, 'organization_id'),
      exceptionDate: _s(j, 'exception_date'),
      isUnavailable: _b(j, 'is_unavailable'),
      replacementStartTime: _sN(j, 'replacement_start_time'),
      replacementEndTime: _sN(j, 'replacement_end_time'),
      reasonCode: availabilityExceptionReasonCodeFromWire(_s(j, 'reason_code')),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

AvailabilityExceptionResponse decodeAvailabilityExceptionResponse(
        Map<String, dynamic> j) =>
    AvailabilityExceptionResponse(
      data: decodeAvailabilityException(_o(j, 'data')),
      closedSlotCount: _i(j, 'closed_slot_count'),
      generatedSlotCount: _i(j, 'generated_slot_count'),
    );

AvailabilitySlot decodeAvailabilitySlot(Map<String, dynamic> j) =>
    AvailabilitySlot(
      id: _s(j, 'id'),
      membershipId: _s(j, 'membership_id'),
      organizationId: _s(j, 'organization_id'),
      startsAt: _s(j, 'starts_at'),
      endsAt: _s(j, 'ends_at'),
      state: _s(j, 'state'),
      version: _i(j, 'version'),
    );

AvailabilitySlotListResponse decodeAvailabilitySlotListResponse(
        Map<String, dynamic> j) =>
    AvailabilitySlotListResponse(
      data: _list(j, 'data').map(decodeAvailabilitySlot).toList(),
      page: pageFromListBody(j),
    );

AvailabilitySlotGenerationResponse decodeAvailabilitySlotGenerationResponse(
        Map<String, dynamic> j) =>
    AvailabilitySlotGenerationResponse(
      membershipId: _s(j, 'membership_id'),
      organizationId: _s(j, 'organization_id'),
      fromDate: _s(j, 'from_date'),
      toDate: _s(j, 'to_date'),
      generatedSlotCount: _i(j, 'generated_slot_count'),
      version: _i(j, 'version'),
    );

// ---------------------------------------------------------------------------
// Consultations
// ---------------------------------------------------------------------------

Consultation decodeConsultation(Map<String, dynamic> j) => Consultation(
      consultationId: _s(j, 'consultation_id'),
      appointmentId: _s(j, 'appointment_id'),
      organizationId: _s(j, 'organization_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      doctorMembershipId: _s(j, 'doctor_membership_id'),
      status: consultationStatusFromWire(_s(j, 'status')),
      outcomeCode: _sN(j, 'outcome_code'),
      version: _i(j, 'version'),
      startedAt: _sN(j, 'started_at'),
      completedAt: _sN(j, 'completed_at'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

ConsultationRoomToken decodeConsultationRoomToken(Map<String, dynamic> j) =>
    ConsultationRoomToken(
      serverUrl: _s(j, 'server_url'),
      accessToken: _s(j, 'access_token'),
      expiresAt: _s(j, 'expires_at'),
    );

// ---------------------------------------------------------------------------
// Clinical notes
// ---------------------------------------------------------------------------

ClinicalNote decodeClinicalNote(Map<String, dynamic> j) => ClinicalNote(
      noteId: _s(j, 'note_id'),
      consultationId: _s(j, 'consultation_id'),
      authorMembershipId: _s(j, 'author_membership_id'),
      versionNo: _i(j, 'version_no'),
      status: clinicalNoteStatusFromWire(_s(j, 'status')),
      content: _obj(j, 'content'),
      replacesNoteId: _sN(j, 'replaces_note_id'),
      signedAt: _sN(j, 'signed_at'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

ClinicalNoteList decodeClinicalNoteList(Map<String, dynamic> j) =>
    ClinicalNoteList(
      data: _list(j, 'data').map(decodeClinicalNote).toList(),
    );

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

Prescription decodePrescription(Map<String, dynamic> j) => Prescription(
      prescriptionId: _s(j, 'prescription_id'),
      consultationId: _s(j, 'consultation_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      doctorMembershipId: _s(j, 'doctor_membership_id'),
      status: prescriptionStatusFromWire(_s(j, 'status')),
      replacesPrescriptionId: _sN(j, 'replaces_prescription_id'),
      diagnosis: _sN(j, 'diagnosis'),
      cancellationReasonCode: _sN(j, 'cancellation_reason_code'),
      signedAt: _sN(j, 'signed_at'),
      expiresAt: _sN(j, 'expires_at'),
      version: _i(j, 'version'),
      documentStatus: _sN(j, 'document_status'),
      items: _strList(j, 'items'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

PrescriptionList decodePrescriptionList(Map<String, dynamic> j) =>
    PrescriptionList(
      data: _list(j, 'data').map(decodePrescription).toList(),
      page: pageFromListBody(j),
    );

// ---------------------------------------------------------------------------
// Conversations / messaging
// ---------------------------------------------------------------------------

ConversationInbox decodeConversationInbox(Map<String, dynamic> j) =>
    ConversationInbox(
      conversationId: _s(j, 'conversation_id'),
      consultationId: _s(j, 'consultation_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      status: _s(j, 'status'),
      latestMessageId: _s(j, 'latest_message_id'),
      latestMessageAt: _s(j, 'latest_message_at'),
      updatedAt: _s(j, 'updated_at'),
      unreadCount: _i(j, 'unread_count'),
    );

ConversationInboxList decodeConversationInboxList(Map<String, dynamic> j) =>
    ConversationInboxList(
      data: _list(j, 'data').map(decodeConversationInbox).toList(),
      page: pageFromListBody(j),
    );

Message decodeMessage(Map<String, dynamic> j) => Message(
      messageId: _s(j, 'message_id'),
      conversationId: _s(j, 'conversation_id'),
      senderProfileId: _s(j, 'sender_profile_id'),
      sequenceNo: _i(j, 'sequence_no'),
      clientCorrelationId: _s(j, 'client_correlation_id'),
      messageType: messageTypeFromWire(_s(j, 'message_type')),
      textContent: _sN(j, 'text_content'),
      fileObjectId: _sN(j, 'file_object_id'),
      isMe: _b(j, 'is_me'),
      deliveredAt: _sN(j, 'delivered_at'),
      readAt: _sN(j, 'read_at'),
      createdAt: _s(j, 'created_at'),
    );

MessageList decodeMessageList(Map<String, dynamic> j) => MessageList(
      data: _list(j, 'data').map(decodeMessage).toList(),
      page: pageFromListBody(j),
    );

// ---------------------------------------------------------------------------
// Clinical templates
// ---------------------------------------------------------------------------

ClinicalTemplate decodeClinicalTemplate(Map<String, dynamic> j) =>
    ClinicalTemplate(
      templateId: _s(j, 'template_id'),
      authorMembershipId: _s(j, 'author_membership_id'),
      organizationId: _s(j, 'organization_id'),
      name: _s(j, 'name'),
      description: _sN(j, 'description'),
      specialty: _sN(j, 'specialty'),
      content: _obj(j, 'content'),
      status: clinicalTemplateStatusFromWire(_s(j, 'status')),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

ClinicalTemplateList decodeClinicalTemplateList(Map<String, dynamic> j) =>
    ClinicalTemplateList(
      data: _list(j, 'data').map(decodeClinicalTemplate).toList(),
      page: pageFromListBody(j),
    );

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

DoctorAiAssistantResponse decodeDoctorAiAssistantResponse(
        Map<String, dynamic> j) =>
    DoctorAiAssistantResponse(
      response: _s(j, 'response'),
      provider: _s(j, 'provider'),
      model: _s(j, 'model'),
      patientProfileId: _sN(j, 'patient_profile_id'),
      consultationId: _sN(j, 'consultation_id'),
      promptTokens: _i(j, 'prompt_tokens'),
      completionTokens: _i(j, 'completion_tokens'),
      latencyMs: _i(j, 'latency_ms'),
      correlationId: _s(j, 'correlation_id'),
    );

AiArtifactContent decodeAiArtifactContent(Map<String, dynamic> j) =>
    AiArtifactContent(
      nonDiagnostic: _b(j, 'non_diagnostic'),
    );

AiArtifact decodeAiArtifact(Map<String, dynamic> j) => AiArtifact(
      artifactId: _s(j, 'artifact_id'),
      generationId: _s(j, 'generation_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      artifactType: aiArtifactTypeFromWire(_s(j, 'artifact_type')),
      versionNo: _i(j, 'version_no'),
      reviewStatus: aiReviewStatusFromWire(_s(j, 'review_status')),
      riskLevel: aiRiskLevelFromWire(_s(j, 'risk_level')),
      confidence: _dN(j, 'confidence'),
      content: decodeAiArtifactContent(_o(j, 'content')),
      modelId: _s(j, 'model_id'),
      promptTemplateId: _s(j, 'prompt_template_id'),
      replacesArtifactId: _sN(j, 'replaces_artifact_id'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

AiArtifactList decodeAiArtifactList(Map<String, dynamic> j) => AiArtifactList(
      data: _list(j, 'data').map(decodeAiArtifact).toList(),
      page: pageFromListBody(j),
    );

// ---------------------------------------------------------------------------
// IoT devices / vitals / alerts
// ---------------------------------------------------------------------------

DoctorDevice decodeDoctorDevice(Map<String, dynamic> j) => DoctorDevice(
      id: _s(j, 'id'),
      serialNumber: _s(j, 'serial_number'),
      deviceType: deviceTypeFromWire(_s(j, 'device_type')),
      state: deviceStateFromWire(_s(j, 'state')),
      lastSeenAt: _sN(j, 'last_seen_at'),
      patientProfileId: _s(j, 'patient_profile_id'),
      version: _i(j, 'version'),
    );

DoctorDeviceList decodeDoctorDeviceList(Map<String, dynamic> j) =>
    DoctorDeviceList(
      data: _list(j, 'data').map(decodeDoctorDevice).toList(),
      page: pageFromListBody(j),
    );

/// Full device projection (`serializeDevice`), returned by
/// `GET /doctor/available-devices` and by the assign/release mutation
/// responses. Both [decodeDoctorDevice] and this decoder now carry `version`.
DeviceAssignment decodeDeviceAssignment(Map<String, dynamic> j) =>
    DeviceAssignment(
      id: _s(j, 'id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      assignedByProfileId: _s(j, 'assigned_by_profile_id'),
      assignedAt: _s(j, 'assigned_at'),
    );

Device decodeDevice(Map<String, dynamic> j) => Device(
      id: _s(j, 'id'),
      organizationId: _s(j, 'organization_id'),
      deviceType: deviceTypeFromWire(_s(j, 'device_type')),
      serialNumber: _s(j, 'serial_number'),
      hardwareRevision: _sN(j, 'hardware_revision'),
      firmwareVersion: _sN(j, 'firmware_version'),
      state: deviceStateFromWire(_s(j, 'state')),
      provisionedAt: _s(j, 'provisioned_at'),
      lastSeenAt: _sN(j, 'last_seen_at'),
      activeAssignment: j['active_assignment'] == null
          ? null
          : decodeDeviceAssignment(_o(j, 'active_assignment')),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

DeviceListResponse decodeDeviceListResponse(Map<String, dynamic> j) =>
    DeviceListResponse(
      data: _list(j, 'data').map(decodeDevice).toList(),
      page: pageFromListBody(j),
    );

VitalReading decodeVitalReading(Map<String, dynamic> j) => VitalReading(
      id: _s(j, 'id'),
      deviceId: _s(j, 'device_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      metric: vitalMetricFromWire(_s(j, 'metric')),
      value: _d(j, 'value'),
      unit: _s(j, 'unit'),
      recordedAt: _s(j, 'recorded_at'),
      ingestedAt: _s(j, 'ingested_at'),
      quality: vitalReadingQualityFromWire(_s(j, 'quality')),
    );

VitalReadingListResponse decodeVitalReadingListResponse(
        Map<String, dynamic> j) =>
    VitalReadingListResponse(
      data: _list(j, 'data').map(decodeVitalReading).toList(),
      page: pageFromListBody(j),
    );

HealthAlert decodeHealthAlert(Map<String, dynamic> j) => HealthAlert(
      id: _s(j, 'id'),
      organizationId: _s(j, 'organization_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      deviceId: _s(j, 'device_id'),
      metric: vitalMetricFromWire(_s(j, 'metric')),
      observedValue: _d(j, 'observed_value'),
      thresholdId: _s(j, 'threshold_id'),
      severity: healthAlertSeverityFromWire(_s(j, 'severity')),
      state: healthAlertStateFromWire(_s(j, 'state')),
      observedAt: _s(j, 'observed_at'),
      acknowledgedByProfileId: _sN(j, 'acknowledged_by_profile_id'),
      acknowledgedAt: _sN(j, 'acknowledged_at'),
      resolvedAt: _sN(j, 'resolved_at'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

HealthAlertListResponse decodeHealthAlertListResponse(Map<String, dynamic> j) =>
    HealthAlertListResponse(
      data: _list(j, 'data').map(decodeHealthAlert).toList(),
      page: pageFromListBody(j),
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

// ---------------------------------------------------------------------------
// Doctor professional details
// ---------------------------------------------------------------------------

DoctorProfessionalDetail decodeDoctorProfessionalDetail(
        Map<String, dynamic> j) =>
    DoctorProfessionalDetail(
      membershipId: _s(j, 'membership_id'),
      biography: _sN(j, 'biography'),
      yearsExperience: _iN(j, 'years_experience'),
      consultationFeeSen: _i(j, 'consultation_fee_sen'),
      currency: _s(j, 'currency'),
      acceptsNewPatients: _b(j, 'accepts_new_patients'),
      specialties: _strList(j, 'specialties'),
      languages: _strList(j, 'languages'),
      version: _i(j, 'version'),
    );

// ---------------------------------------------------------------------------
// Verification documents
// ---------------------------------------------------------------------------

VerificationDocumentView decodeVerificationDocumentView(
        Map<String, dynamic> j) =>
    VerificationDocumentView(
      documentId: _s(j, 'document_id'),
      membershipId: _s(j, 'membership_id'),
      organizationId: _s(j, 'organization_id'),
      objectId: _s(j, 'object_id'),
      documentKind: verificationDocumentKindFromWire(_s(j, 'document_kind')),
      status: verificationStatusFromWire(_s(j, 'status')),
      submittedAt: _s(j, 'submitted_at'),
      reviewedAt: _sN(j, 'reviewed_at'),
      reviewerProfileId: _sN(j, 'reviewer_profile_id'),
      reasonCode: _sN(j, 'reason_code') == null
          ? null
          : verificationReasonCodeFromWire(_sN(j, 'reason_code')!),
      expiresAt: _sN(j, 'expires_at'),
      objectKey: _s(j, 'object_key'),
      contentType: _s(j, 'content_type'),
      byteSize: _i(j, 'byte_size'),
      declaredSha256: _s(j, 'declared_sha256'),
      verifiedSha256: _sN(j, 'verified_sha256'),
      uploadState: verificationObjectUploadStateFromWire(_s(j, 'upload_state')),
      scanState: verificationObjectScanStateFromWire(_s(j, 'scan_state')),
      downloadable: _b(j, 'downloadable'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

VerificationDocumentListResponse decodeVerificationDocumentListResponse(
        Map<String, dynamic> j) =>
    VerificationDocumentListResponse(
      data: _list(j, 'data').map(decodeVerificationDocumentView).toList(),
    );

VerificationUploadTarget decodeVerificationUploadTarget(
        Map<String, dynamic> j) =>
    VerificationUploadTarget(
      method: _s(j, 'method'),
      url: _s(j, 'url'),
      expiresAt: _s(j, 'expires_at'),
      requiredHeaders: _obj(j, 'required_headers'),
    );

RequestVerificationUploadResponse decodeRequestVerificationUploadResponse(
        Map<String, dynamic> j) =>
    RequestVerificationUploadResponse(
      document: decodeVerificationDocumentView(_o(j, 'document')),
      upload: decodeVerificationUploadTarget(_o(j, 'upload')),
    );

// ---------------------------------------------------------------------------
// Emergency
// ---------------------------------------------------------------------------

EmergencyEventView decodeEmergencyEventView(Map<String, dynamic> j) =>
    EmergencyEventView(
      emergencyEventId: _s(j, 'emergency_event_id'),
      status: emergencyEventStatusFromWire(_s(j, 'status')),
      triagePriority: triagePriorityFromWire(_s(j, 'triage_priority')),
      categoryCode: _s(j, 'category_code'),
      version: _i(j, 'version'),
    );

EmergencyEventSummary decodeEmergencyEventSummary(Map<String, dynamic> j) =>
    EmergencyEventSummary(
      emergencyEventId: _s(j, 'emergency_event_id'),
      siteId: _sN(j, 'site_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      reportedByProfileId: _s(j, 'reported_by_profile_id'),
      status: _s(j, 'status'),
      triagePriority: _s(j, 'triage_priority'),
      categoryCode: _s(j, 'category_code'),
      reasonCode: _sN(j, 'reason_code'),
      latitude: _sN(j, 'latitude'),
      longitude: _sN(j, 'longitude'),
      addressText: _sN(j, 'address_text'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      triagedAt: _sN(j, 'triaged_at'),
      dispatchedAt: _sN(j, 'dispatched_at'),
      onSceneAt: _sN(j, 'on_scene_at'),
      resolvedAt: _sN(j, 'resolved_at'),
    );

EmergencyEventList decodeEmergencyEventList(Map<String, dynamic> j) =>
    EmergencyEventList(
      data: _list(j, 'data').map(decodeEmergencyEventSummary).toList(),
    );

// ---------------------------------------------------------------------------
// Break-glass
// ---------------------------------------------------------------------------

BreakGlassGrant decodeBreakGlassGrant(Map<String, dynamic> j) =>
    BreakGlassGrant(
      breakGlassGrantId: _s(j, 'break_glass_grant_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      expiresAt: _s(j, 'expires_at'),
    );

BreakGlassDisclosure decodeBreakGlassDisclosure(Map<String, dynamic> j) =>
    BreakGlassDisclosure(
      breakGlassGrantId: _s(j, 'break_glass_grant_id'),
      patientProfileId: _s(j, 'patient_profile_id'),
      displayName: _s(j, 'display_name'),
      allergies: _rawMapList(j, 'allergies'),
      activeConditions: _rawMapList(j, 'active_conditions'),
    );

List<Map<String, Object?>> _rawMapList(Map<String, dynamic> j, String k) {
  final v = j[k];
  if (v is List) {
    return v.whereType<Map>().map((m) => Map<String, Object?>.from(m)).toList();
  }
  return <Map<String, Object?>>[];
}

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

Medication decodeMedication(Map<String, dynamic> j) => Medication(
      medicationId: _s(j, 'medication_id'),
      genericName: _s(j, 'generic_name'),
      atcCode: _sN(j, 'atc_code'),
      controlledSchedule:
          controlledSubstanceScheduleFromWire(_s(j, 'controlled_schedule')),
      controlledSubstance: _b(j, 'controlled_substance'),
      requiresPrescription: _b(j, 'requires_prescription'),
      retired: _b(j, 'retired'),
      version: _i(j, 'version'),
      createdAt: _s(j, 'created_at'),
      updatedAt: _s(j, 'updated_at'),
    );

MedicationList decodeMedicationList(Map<String, dynamic> j) => MedicationList(
      data: _list(j, 'data').map(decodeMedication).toList(),
    );
