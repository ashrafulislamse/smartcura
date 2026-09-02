// GENERATED FILE - DO NOT EDIT.
// Source: OpenAPI 3.1.0, contract 0.1.0

export type UnknownEnumValue = string & { readonly __smartCuraUnknownEnum: 'unknown' };

export type UuidV7 = string;

export type Timestamp = string;

export interface Money {
  readonly amount_sen: number;
  readonly currency: "MYR";
}

export type RoleId = "patient" | "doctor" | "driver" | "pharmacy" | "emergency" | "admin" | "super_admin" | UnknownEnumValue;

export type ProfileStatus = "pending" | "active" | "suspended" | "deactivated" | UnknownEnumValue;

export type MembershipStatus = "applied" | "invited" | "active" | "suspended" | "revoked" | "expired" | UnknownEnumValue;

export type VerificationStatus = "not_submitted" | "pending_review" | "changes_requested" | "approved" | "rejected" | "suspended" | "expired" | UnknownEnumValue;

export type AppSessionStatus = "active" | "idle_expired" | "absolute_expired" | "revoked" | "membership_ended" | UnknownEnumValue;

export type ClientType = "patient_flutter" | "doctor_flutter" | "driver_flutter" | "web_portal" | UnknownEnumValue;

export type BootstrapState = "profile_required" | "verification_pending" | "role_selection_required" | "ready" | UnknownEnumValue;

export interface HealthResponse {
  readonly status: "ok";
  readonly version: string;
  readonly time: Timestamp;
}

export interface DependencyReadiness {
  readonly name: string;
  readonly ready: boolean;
}

export interface ReadinessResponse {
  readonly status: "ready" | "not_ready" | UnknownEnumValue;
  readonly checks: ReadonlyArray<DependencyReadiness>;
  readonly time: Timestamp;
}

export interface Profile {
  readonly id: UuidV7;
  readonly status: ProfileStatus;
  readonly display_name: string;
  readonly email: string;
  readonly phone_e164: string | null;
  readonly preferred_locale: string;
  readonly timezone: string;
  readonly onboarding_completed_at: Timestamp | null;
  readonly avatar_url: string | null;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface Membership {
  readonly id: UuidV7;
  readonly organization_id: UuidV7;
  readonly site_ids: ReadonlyArray<UuidV7>;
  readonly role: RoleId;
  readonly status: MembershipStatus;
  readonly verification_status?: VerificationStatus | null;
  readonly permissions: ReadonlyArray<string>;
}

export interface SessionView {
  readonly id: UuidV7;
  readonly status: AppSessionStatus;
  readonly profile_id: UuidV7;
  readonly active_role: RoleId | null;
  readonly created_at: Timestamp;
  readonly last_activity_at: Timestamp;
  readonly idle_expires_at: Timestamp;
  readonly absolute_expires_at: Timestamp;
  readonly step_up_valid_until: Timestamp | null;
}

export interface CreateSessionRequest {
  readonly client_type: ClientType;
  readonly device_name: string;
  readonly requested_role?: RoleId | null;
}

export interface SessionBootstrapResponse {
  readonly bootstrap_state: BootstrapState;
  readonly csrf_token: string;
  readonly profile: Profile;
  readonly memberships: ReadonlyArray<Membership>;
  readonly session: SessionView;
}

export interface SelectActiveRoleRequest {
  readonly membership_id: UuidV7;
}

export type StepUpReason = "role_switch" | "prescription_sign" | "break_glass" | "controlled_substance" | "payout" | "withdrawal" | "security_change" | "dependant_access_change" | "custom_role_change" | "maintenance_change" | "dead_letter_replay" | UnknownEnumValue;

export interface StepUpRequest {
  readonly reason: StepUpReason;
}

export interface StepUpResponse {
  readonly session_id: UuidV7;
  readonly valid_until: Timestamp;
  readonly csrf_token: string;
}

export interface MembershipAdministrationView {
  readonly id: UuidV7;
  readonly profile_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly role: RoleId;
  readonly status: MembershipStatus;
  readonly verification_status: VerificationStatus | null;
  readonly site_ids: ReadonlyArray<UuidV7>;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface MembershipAdministrationListResponse {
  readonly data: ReadonlyArray<MembershipAdministrationView>;
  readonly page: PageInfo;
}

export interface CreateSelfMembershipRequest {
  readonly role: "patient" | "doctor" | "driver" | "pharmacy" | "emergency" | UnknownEnumValue;
  readonly site_ids: ReadonlyArray<UuidV7>;
}

export interface CreateMembershipInvitationRequest {
  readonly profile_id: UuidV7;
  readonly role: "patient" | "doctor" | "driver" | "pharmacy" | "emergency" | "admin" | UnknownEnumValue;
  readonly site_ids: ReadonlyArray<UuidV7>;
}

export interface TransitionMembershipStatusRequest {
  readonly status: "active" | "suspended" | "revoked" | UnknownEnumValue;
  readonly reason_code: "administrative_request" | "verification_revoked" | "verification_approved" | "policy_violation" | "security_incident" | "duplicate_membership" | "offboarding" | "data_correction" | "organization_closed" | UnknownEnumValue;
  readonly expected_version: number;
}

export interface UpdateMyProfileRequest {
  readonly display_name?: string;
  readonly phone_e164?: string | null;
  readonly preferred_locale?: string;
  readonly timezone?: string;
  readonly complete_onboarding?: true;
}

export type Sha256Hex = string;

export type VerificationDocumentKind = "medical_license" | "national_id" | "driving_licence" | "vehicle_registration" | "pharmacy_licence" | "qualification_certificate" | "professional_indemnity" | UnknownEnumValue;

export type VerificationObjectUploadState = "pending" | "finalized" | "quarantined" | "deleted" | "rejected" | UnknownEnumValue;

export type VerificationObjectScanState = "not_scanned" | "scanning" | "clean" | "infected" | "scan_failed" | UnknownEnumValue;

export type VerificationReasonCode = "document_illegible" | "document_expired" | "name_mismatch" | "wrong_document_type" | "suspected_forgery" | "licence_not_verifiable" | "approved_verified" | "administrative_request" | "policy_violation" | UnknownEnumValue;

export interface VerificationDocumentView {
  readonly document_id: UuidV7;
  readonly membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly object_id: UuidV7;
  readonly document_kind: VerificationDocumentKind;
  readonly status: VerificationStatus;
  readonly submitted_at: Timestamp;
  readonly reviewed_at: Timestamp | null;
  readonly reviewer_profile_id: UuidV7 | null;
  readonly reason_code: VerificationReasonCode | null;
  readonly expires_at: Timestamp | null;
  readonly object_key: string;
  readonly content_type: "application/pdf" | "image/jpeg" | "image/png" | UnknownEnumValue;
  readonly byte_size: number;
  readonly declared_sha256: Sha256Hex;
  readonly verified_sha256: Sha256Hex | null;
  readonly upload_state: VerificationObjectUploadState;
  readonly scan_state: VerificationObjectScanState;
  readonly downloadable: boolean;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface VerificationDocumentListResponse {
  readonly data: ReadonlyArray<VerificationDocumentView>;
}

export interface RequestVerificationUploadRequest {
  readonly document_kind: VerificationDocumentKind;
  readonly content_type: "application/pdf" | "image/jpeg" | "image/png" | UnknownEnumValue;
  readonly byte_size: number;
  readonly declared_sha256: Sha256Hex;
  readonly document_expires_at?: Timestamp | null;
}

export interface VerificationUploadTarget {
  readonly method: "PUT" | UnknownEnumValue;
  readonly url: string;
  readonly expires_at: Timestamp;
  readonly required_headers: Readonly<Record<string, unknown>>;
}

export interface RequestVerificationUploadResponse {
  readonly document: VerificationDocumentView;
  readonly upload: VerificationUploadTarget;
}

export interface FinalizeVerificationDocumentRequest {
  readonly reported_sha256: string;
}

export interface ReviewVerificationDocumentRequest {
  readonly status: "changes_requested" | "approved" | "rejected" | "suspended" | "expired" | UnknownEnumValue;
  readonly reason_code: VerificationReasonCode;
  readonly expected_version: number;
}

export interface PageInfo {
  readonly has_more: boolean;
  readonly next_cursor: string | null;
}

export type LocalTime = string;

export type CalendarDate = string;

export type AppointmentMode = "video" | "audio" | "chat" | "in_person" | UnknownEnumValue;

export type AppointmentStatus = "pending_payment" | "confirmed" | "checked_in" | "in_progress" | "cancelled" | "completed" | "no_show" | "rescheduled" | UnknownEnumValue;

export type AppointmentPaymentState = "pending" | "captured" | "refunded" | "failed" | UnknownEnumValue;

export type AppointmentCancellationReasonCode = "patient_request" | "doctor_unavailable" | "schedule_conflict" | "payment_expired" | "duplicate_booking" | "clinical_reason" | "administrative_action" | UnknownEnumValue;

export type AppointmentNoShowReasonCode = "patient_absent" | "patient_late" | "patient_unreachable" | UnknownEnumValue;

export type AppointmentReasonCode = "patient_request" | "doctor_unavailable" | "schedule_conflict" | "payment_expired" | "duplicate_booking" | "clinical_reason" | "administrative_action" | "patient_absent" | "patient_late" | "patient_unreachable" | "rescheduled" | UnknownEnumValue;

export type AvailabilityExceptionReasonCode = "annual_leave" | "sick_leave" | "public_holiday" | "training" | "administrative_block" | "clinic_closure" | "schedule_correction" | "emergency_cover" | UnknownEnumValue;

export interface AvailabilityRuleInput {
  readonly weekday: number;
  readonly start_time: LocalTime;
  readonly end_time: string;
  readonly slot_duration_minutes: number;
  readonly timezone: string;
  readonly effective_from: CalendarDate;
  readonly effective_to?: CalendarDate | null;
}

export interface AvailabilityRule {
  readonly id: UuidV7;
  readonly membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly weekday: number;
  readonly start_time: LocalTime;
  readonly end_time: LocalTime;
  readonly slot_duration_minutes: number;
  readonly timezone: string;
  readonly effective_from: CalendarDate;
  readonly effective_to: CalendarDate | null;
  readonly is_active: boolean;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface AvailabilityRuleSetResponse {
  readonly data: ReadonlyArray<AvailabilityRule>;
  readonly version: number;
}

export interface ReplaceAvailabilityRulesRequest {
  readonly rules: ReadonlyArray<AvailabilityRuleInput>;
  readonly expected_version: number;
  readonly horizon_days?: number;
}

export interface AvailabilityRulesResponse {
  readonly data: ReadonlyArray<AvailabilityRule>;
  readonly version: number;
  readonly generated_slot_count: number;
}

export interface RecordAvailabilityExceptionRequest {
  readonly exception_date: CalendarDate;
  readonly is_unavailable: boolean;
  readonly replacement_start_time?: LocalTime | null;
  readonly replacement_end_time?: LocalTime | null;
  readonly reason_code: AvailabilityExceptionReasonCode;
  readonly expected_version: number;
}

export interface AvailabilityException {
  readonly id: UuidV7;
  readonly membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly exception_date: CalendarDate;
  readonly is_unavailable: boolean;
  readonly replacement_start_time: LocalTime | null;
  readonly replacement_end_time: LocalTime | null;
  readonly reason_code: AvailabilityExceptionReasonCode;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface AvailabilityExceptionResponse {
  readonly data: AvailabilityException;
  readonly closed_slot_count: number;
  readonly generated_slot_count: number;
}

export interface GenerateAvailabilitySlotsRequest {
  readonly from_date: CalendarDate;
  readonly to_date: string;
}

export interface AvailabilitySlotGenerationResponse {
  readonly membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly from_date: CalendarDate;
  readonly to_date: CalendarDate;
  readonly generated_slot_count: number;
  readonly version: number;
}

export interface AvailabilitySlot {
  readonly id: UuidV7;
  readonly membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly starts_at: Timestamp;
  readonly ends_at: Timestamp;
  readonly state: "open" | "held" | "booked" | "closed" | UnknownEnumValue;
  readonly version: number;
}

export interface AvailabilitySlotListResponse {
  readonly data: ReadonlyArray<AvailabilitySlot>;
  readonly page: PageInfo;
}

export interface SlotHold {
  readonly slot_id: UuidV7;
  readonly membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly starts_at: Timestamp;
  readonly ends_at: Timestamp;
  readonly held_until: Timestamp;
  readonly version: number;
}

export interface BookAppointmentRequest {
  readonly slot_id: UuidV7;
  readonly mode: AppointmentMode;
}

export interface Appointment {
  readonly id: UuidV7;
  readonly slot_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly doctor_membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly mode: AppointmentMode;
  readonly status: AppointmentStatus;
  readonly starts_at: Timestamp;
  readonly ends_at: Timestamp;
  readonly fee_sen: number;
  readonly currency: "MYR";
  readonly payment_state: AppointmentPaymentState | null;
  readonly cancellation_reason_code: AppointmentReasonCode | null;
  readonly replaced_by_appointment_id: UuidV7 | null;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface RescheduledAppointment {
  readonly id: UuidV7;
  readonly slot_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly doctor_membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly mode: AppointmentMode;
  readonly status: AppointmentStatus;
  readonly starts_at: Timestamp;
  readonly ends_at: Timestamp;
  readonly fee_sen: number;
  readonly currency: "MYR";
  readonly payment_state: AppointmentPaymentState | null;
  readonly cancellation_reason_code: AppointmentReasonCode | null;
  readonly replaced_by_appointment_id: UuidV7 | null;
  readonly replaces_appointment_id?: string;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface AppointmentListResponse {
  readonly data: ReadonlyArray<Appointment>;
  readonly page: PageInfo;
}

export interface CancelAppointmentRequest {
  readonly status: "cancelled";
  readonly reason_code: AppointmentCancellationReasonCode;
  readonly expected_version: number;
}

export interface CompleteAppointmentRequest {
  readonly status: "completed";
  readonly expected_version: number;
}

export interface RecordAppointmentNoShowRequest {
  readonly status: "no_show";
  readonly reason_code: AppointmentNoShowReasonCode;
  readonly expected_version: number;
}

export interface RescheduleAppointmentRequest {
  readonly slot_id: string;
  readonly mode?: AppointmentMode | null;
  readonly expected_version: number;
}

export type DeviceType = "vitals_monitor" | "ecg" | "thermometer" | "pulse_oximeter" | "simulator" | "phone" | UnknownEnumValue;

export type DeviceState = "provisioned" | "active" | "suspended" | "retired" | UnknownEnumValue;

export type DeviceCredentialType = "mqtt_password" | "client_certificate" | UnknownEnumValue;

export type DeviceReleaseReasonCode = "administrative_request" | "device_replaced" | "device_fault" | "patient_discharged" | "assignment_correction" | "security_incident" | "offboarding" | UnknownEnumValue;

export interface DeviceAssignment {
  readonly id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly assigned_by_profile_id: UuidV7;
  readonly assigned_at: Timestamp;
}

export interface Device {
  readonly id: UuidV7;
  readonly organization_id: UuidV7;
  readonly device_type: DeviceType;
  readonly serial_number: string;
  readonly hardware_revision: string | null;
  readonly firmware_version: string | null;
  readonly state: DeviceState;
  readonly provisioned_at: Timestamp;
  readonly last_seen_at: Timestamp | null;
  readonly active_assignment: DeviceAssignment | null;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface DeviceListResponse {
  readonly data: ReadonlyArray<Device>;
  readonly page: PageInfo;
}

export interface RegisterDeviceRequest {
  readonly device_type: DeviceType;
  readonly serial_number: string;
  readonly hardware_revision?: string | null;
  readonly firmware_version?: string | null;
  readonly credential_type: DeviceCredentialType;
  readonly provisioning_secret: string;
}

export interface AssignDeviceRequest {
  readonly patient_profile_id: string;
  readonly expected_version: number;
}

export interface ReleaseDeviceRequest {
  readonly expected_version: number;
  readonly reason_code: DeviceReleaseReasonCode;
}

export interface OwnAssignDeviceRequest {
  readonly expected_version?: number;
}

export interface OwnReleaseDeviceRequest {
  readonly expected_version: number;
  readonly reason_code: DeviceReleaseReasonCode;
}

export type VitalMetric = "heart_rate" | "oxygen_saturation" | "body_temperature" | "systolic_bp" | "diastolic_bp" | "respiratory_rate" | "ecg_voltage" | "blood_pressure" | "blood_glucose" | "body_weight" | UnknownEnumValue;

export type VitalReadingQuality = "valid" | "suspect" | "invalid" | "unknown" | UnknownEnumValue;

export type HealthAlertSeverity = "info" | "warning" | "critical" | UnknownEnumValue;

export type HealthAlertState = "open" | "acknowledged" | "escalated" | "resolved" | "dismissed" | UnknownEnumValue;

export interface VitalReadingSample {
  readonly boot_id: number;
  readonly sequence_number: number;
  readonly metric: VitalMetric;
  readonly value: number;
  readonly unit: "/min" | "%" | "Cel" | "mm[Hg]" | "mV" | UnknownEnumValue;
  readonly recorded_at: string;
  readonly quality: VitalReadingQuality;
}

export interface IngestVitalReadingsRequest {
  readonly readings: ReadonlyArray<VitalReadingSample>;
}

export interface AcceptedVitalReading {
  readonly id: UuidV7;
  readonly metric: VitalMetric;
  readonly value: number;
  readonly unit: string;
  readonly recorded_at: Timestamp;
  readonly quality: VitalReadingQuality;
}

export interface VitalReadingIngestOutcome {
  readonly device_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly accepted: number;
  readonly deduplicated: number;
  readonly rejected: number;
  readonly alerts_raised: number;
  readonly accepted_readings: ReadonlyArray<AcceptedVitalReading>;
}

export interface VitalReading {
  readonly id: UuidV7;
  readonly device_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly metric: VitalMetric;
  readonly value: number;
  readonly unit: string;
  readonly recorded_at: Timestamp;
  readonly ingested_at: string;
  readonly quality: VitalReadingQuality;
}

export interface VitalReadingListResponse {
  readonly data: ReadonlyArray<VitalReading>;
  readonly page: PageInfo;
}

export interface HealthAlert {
  readonly id: UuidV7;
  readonly organization_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly device_id: UuidV7;
  readonly metric: VitalMetric;
  readonly observed_value: number;
  readonly threshold_id: string;
  readonly severity: HealthAlertSeverity;
  readonly state: HealthAlertState;
  readonly observed_at: string;
  readonly acknowledged_by_profile_id: UuidV7 | null;
  readonly acknowledged_at: Timestamp | null;
  readonly resolved_at: Timestamp | null;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface HealthAlertListResponse {
  readonly data: ReadonlyArray<HealthAlert>;
  readonly page: PageInfo;
}

export interface AcknowledgeHealthAlertRequest {
  readonly expected_version: number;
}

export type ProblemCode = "AUTH_TOKEN_INVALID" | "APP_SESSION_INVALID" | "MEMBERSHIP_INACTIVE" | "PERMISSION_DENIED" | "OBJECT_ACCESS_DENIED" | "CONSENT_REQUIRED" | "STEP_UP_REQUIRED" | "BREAK_GLASS_REQUIRED" | "RESOURCE_NOT_FOUND" | "MEMBERSHIP_ALREADY_EXISTS" | "MEMBERSHIP_VERSION_CONFLICT" | "MEMBERSHIP_TRANSITION_INVALID" | "MEMBERSHIP_SELF_MODIFICATION_DENIED" | "LAST_ADMIN_REQUIRED" | "ROLE_SWITCH_CONFLICT" | "VERIFICATION_DOCUMENT_AWAITING_REVIEW" | "VERIFICATION_DOCUMENT_ALREADY_FINALIZED" | "VERIFICATION_DOCUMENT_VERSION_CONFLICT" | "VERIFICATION_DOCUMENT_TRANSITION_INVALID" | "VERIFICATION_SELF_REVIEW_DENIED" | "OBJECT_CHECKSUM_MISMATCH" | "OBJECT_NOT_DOWNLOADABLE" | "AVAILABILITY_VERSION_CONFLICT" | "AVAILABILITY_RULES_MISSING" | "APPOINTMENT_SLOT_UNAVAILABLE" | "APPOINTMENT_PATIENT_UNAVAILABLE" | "APPOINTMENT_VERSION_CONFLICT" | "APPOINTMENT_TRANSITION_INVALID" | "DEVICE_SERIAL_NUMBER_CONFLICT" | "DEVICE_NOT_ASSIGNABLE" | "DEVICE_ALREADY_ASSIGNED" | "DEVICE_NOT_ASSIGNED" | "DEVICE_VERSION_CONFLICT" | "DEVICE_NOT_INGESTIBLE" | "HEALTH_ALERT_VERSION_CONFLICT" | "HEALTH_ALERT_NOT_OPEN" | "CONSENT_ALREADY_ACTIVE" | "CONSENT_VERSION_CONFLICT" | "CONSENT_NOT_ACTIVE" | "CARE_ASSIGNMENT_ALREADY_ACTIVE" | "CARE_ASSIGNMENT_VERSION_CONFLICT" | "CARE_ASSIGNMENT_NOT_ACTIVE" | "REVIEW_APPOINTMENT_NOT_COMPLETED" | "DOCTOR_REVIEW_VERSION_CONFLICT" | "CARE_ASSIGNMENT_REQUIRED" | "IDEMPOTENCY_KEY_REUSED" | "UNSUPPORTED_MEDIA_TYPE" | "VALIDATION_FAILED" | "RATE_LIMITED" | "DEPENDENCY_UNAVAILABLE" | "INTERNAL_ERROR" | UnknownEnumValue;

export interface FieldViolation {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string | null;
  readonly instance?: string | null;
  readonly code: ProblemCode;
  readonly correlation_id: UuidV7;
  readonly errors?: ReadonlyArray<FieldViolation>;
}

export type ConsentScope = "profile_contact" | "clinical_record" | "medication" | "iot_reading" | "ai_artifact" | "full_record" | UnknownEnumValue;

export type ConsentStatus = "active" | "revoked" | "expired" | UnknownEnumValue;

export type ConsentRevocationReason = "grantor_request" | "grantee_request" | "admin_action" | "superseded" | "policy_violation" | "membership_ended" | UnknownEnumValue;

export interface ConsentGrant {
  readonly id: UuidV7;
  readonly organization_id: UuidV7;
  readonly grantor_profile_id: UuidV7;
  readonly grantee_profile_id: UuidV7 | null;
  readonly grantee_membership_id: UuidV7 | null;
  readonly scope: ConsentScope;
  readonly purpose: string;
  readonly status: ConsentStatus;
  readonly granted_at: Timestamp;
  readonly expires_at: Timestamp | null;
  readonly revoked_at: Timestamp | null;
  readonly revocation_reason: ConsentRevocationReason | null;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface CreateConsentGrantRequest {
  readonly grantee_profile_id?: UuidV7 | null;
  readonly grantee_membership_id?: UuidV7 | null;
  readonly scope: ConsentScope;
  readonly purpose: string;
  readonly expires_at?: Timestamp | null;
}

export interface RevokeConsentGrantRequest {
  readonly expected_version: number;
  readonly reason: ConsentRevocationReason;
}

export interface ConsentGrantPage {
  readonly data: ReadonlyArray<ConsentGrant>;
  readonly page: PageInfo;
}

export type CareAssignmentStatus = "active" | "completed" | "revoked" | "expired" | UnknownEnumValue;

export type CareAssignmentEndReason = "care_completed" | "patient_request" | "clinician_request" | "administrative_request" | "membership_ended" | "assignment_correction" | UnknownEnumValue;

export interface CareAssignment {
  readonly id: UuidV7;
  readonly organization_id: UuidV7;
  readonly clinician_membership_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly status: CareAssignmentStatus;
  readonly assigned_at: Timestamp;
  readonly ended_at: Timestamp | null;
  readonly ended_reason: CareAssignmentEndReason | null;
  readonly assigned_by_membership_id: UuidV7 | null;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface CreateCareAssignmentRequest {
  readonly clinician_membership_id: UuidV7;
  readonly patient_profile_id: UuidV7;
}

export interface EndCareAssignmentRequest {
  readonly expected_version: number;
  readonly status: "completed" | "revoked" | UnknownEnumValue;
  readonly reason: CareAssignmentEndReason;
}

export interface CareAssignmentPage {
  readonly data: ReadonlyArray<CareAssignment>;
  readonly page: PageInfo;
}

export type DoctorReviewTag = "good_listener" | "on_time" | "clear_explanation" | "professional" | "helpful" | UnknownEnumValue;

export interface PublicDoctorReview {
  readonly id: UuidV7;
  readonly rating: number;
  readonly comment: string | null;
  readonly tags: ReadonlyArray<DoctorReviewTag>;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface DoctorDirectoryItem {
  readonly membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly display_name: string;
  readonly image_url: string | null;
  readonly practice_name: string;
  readonly biography: string | null;
  readonly years_experience: number;
  readonly consultation_fee_sen: number;
  readonly currency: "MYR";
  readonly accepts_new_patients: boolean;
  readonly verified: true;
  readonly primary_specialty: string | null;
  readonly specialties: ReadonlyArray<string>;
  readonly languages: ReadonlyArray<string>;
  readonly rating_average: number;
  readonly review_count: number;
  readonly next_available_at: Timestamp | null;
}

export type DoctorProfile = string;

export interface DoctorDirectoryPage {
  readonly data: ReadonlyArray<DoctorDirectoryItem>;
  readonly page: PageInfo;
}

export interface DoctorReviewPage {
  readonly data: ReadonlyArray<PublicDoctorReview>;
  readonly page: PageInfo;
}

export interface PutDoctorReviewRequest {
  readonly expected_version: number;
  readonly rating: number;
  readonly comment?: string | null;
  readonly tags?: ReadonlyArray<DoctorReviewTag>;
}

export interface SavedDoctorReview {
  readonly id: UuidV7;
  readonly appointment_id: UuidV7;
  readonly doctor_membership_id: UuidV7;
  readonly rating: number;
  readonly comment: string | null;
  readonly tags: ReadonlyArray<DoctorReviewTag>;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
  readonly replayed: boolean;
}

export interface VerificationFileObject {
  readonly object_id: UuidV7;
  readonly content_type: "application/pdf" | "image/jpeg" | "image/png" | UnknownEnumValue;
  readonly byte_size: number;
  readonly sha256: Sha256Hex;
}

export interface VerificationDownloadTarget {
  readonly method: "GET" | UnknownEnumValue;
  readonly url: string;
  readonly expires_at: Timestamp;
  readonly required_headers: Readonly<Record<string, unknown>>;
}

export interface VerificationFileDownloadResponse {
  readonly object: VerificationFileObject;
  readonly download: VerificationDownloadTarget;
}

export interface CheckInAppointmentRequest {
  readonly status: "checked_in";
  readonly expected_version: number;
}

export interface StartAppointmentRequest {
  readonly status: "in_progress";
  readonly expected_version: number;
}

export type ConsultationStatus = "not_started" | "ready" | "in_progress" | "completed" | "cancelled" | UnknownEnumValue;

export interface Consultation {
  readonly consultation_id: UuidV7;
  readonly appointment_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly doctor_membership_id: UuidV7;
  readonly status: ConsultationStatus;
  readonly outcome_code: string | null;
  readonly version: number;
  readonly started_at: Timestamp | null;
  readonly completed_at: Timestamp | null;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface ConsultationList {
  readonly data: ReadonlyArray<Consultation>;
  readonly page: PageInfo;
}

export interface ConsultationTransitionRequest {
  readonly status: "ready" | "in_progress" | "completed" | "cancelled" | UnknownEnumValue;
  readonly outcome_code: string | null;
  readonly expected_version: number;
}

export interface ConsultationRoomToken {
  readonly server_url: string;
  readonly access_token: string;
  readonly expires_at: Timestamp;
}

export type ClinicalNoteStatus = "draft" | "signed" | "superseded" | "discarded" | UnknownEnumValue;

export type ClinicalNoteContent = Readonly<Record<string, unknown>>;

export interface ClinicalNote {
  readonly note_id: UuidV7;
  readonly consultation_id: UuidV7;
  readonly author_membership_id: UuidV7;
  readonly version_no: number;
  readonly status: ClinicalNoteStatus;
  readonly content: ClinicalNoteContent;
  readonly replaces_note_id: UuidV7 | null;
  readonly signed_at: Timestamp | null;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface ClinicalNoteList {
  readonly data: ReadonlyArray<ClinicalNote>;
}

export interface CreateClinicalNoteRequest {
  readonly content: ClinicalNoteContent;
}

export interface UpdateClinicalNoteRequest {
  readonly content: ClinicalNoteContent;
  readonly expected_version: number;
}

export interface TransitionClinicalNoteRequest {
  readonly status: "signed" | "discarded" | UnknownEnumValue;
  readonly expected_version: number;
}

export interface AmendClinicalNoteRequest {
  readonly content: ClinicalNoteContent;
  readonly expected_version: number;
}

export interface Conversation {
  readonly conversation_id: UuidV7;
  readonly consultation_id: UuidV7;
  readonly status: "active" | "closed" | UnknownEnumValue;
}

export type MessageType = "text" | "file" | "system" | UnknownEnumValue;

export interface Message {
  readonly message_id: UuidV7;
  readonly conversation_id: UuidV7;
  readonly sender_profile_id: UuidV7;
  readonly sequence_no: number;
  readonly client_correlation_id: UuidV7;
  readonly message_type: MessageType;
  readonly text_content: string | null;
  readonly file_object_id: UuidV7 | null;
  readonly is_me: boolean;
  readonly delivered_at: Timestamp | null;
  readonly read_at: Timestamp | null;
  readonly created_at: Timestamp;
}

export interface MessageList {
  readonly data: ReadonlyArray<Message>;
  readonly page: PageInfo;
}

export interface CreateMessageRequest {
  readonly message_type: "text" | "file" | UnknownEnumValue;
  readonly text_content?: string | null;
  readonly file_object_id?: UuidV7 | null;
  readonly client_correlation_id: UuidV7;
}

export interface MarkConversationReadRequest {
  readonly through_sequence_no: number;
}

export interface MarkConversationReadResult {
  readonly updated_receipts: number;
  readonly through_sequence_no: number;
}

export type PrescriptionStatus = "draft" | "signed" | "superseded" | "cancelled" | "expired" | "discarded" | UnknownEnumValue;

export interface PrescriptionItemInput {
  readonly medication_reference: string | null;
  readonly medication_text: string | null;
  readonly dose_value: string;
  readonly dose_unit: string;
  readonly route_code: string;
  readonly frequency_code: string | null;
  readonly frequency_text: string | null;
  readonly duration_days: number;
  readonly patient_instructions: string | null;
}

export type PrescriptionItem = string;

export interface Prescription {
  readonly prescription_id: UuidV7;
  readonly consultation_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly doctor_membership_id: UuidV7;
  readonly status: PrescriptionStatus;
  readonly replaces_prescription_id: UuidV7 | null;
  readonly diagnosis: string | null;
  readonly cancellation_reason_code: string | null;
  readonly signed_at: Timestamp | null;
  readonly expires_at: Timestamp | null;
  readonly version: number;
  readonly document_status: "pending" | "ready" | "failed" | null | UnknownEnumValue | "pending" | "ready" | "failed" | null | UnknownEnumValue;
  readonly items: ReadonlyArray<PrescriptionItem>;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface CreatePrescriptionRequest {
  readonly items: ReadonlyArray<PrescriptionItemInput>;
  readonly diagnosis?: string | null;
}

export interface UpdatePrescriptionRequest {
  readonly items: ReadonlyArray<PrescriptionItemInput>;
  readonly diagnosis?: string | null;
  readonly expected_version: number;
}

export interface TransitionPrescriptionRequest {
  readonly status: "signed" | "discarded" | UnknownEnumValue;
  readonly expected_version: number;
  readonly expires_at: Timestamp | null;
}

export interface SupersedePrescriptionRequest {
  readonly items: ReadonlyArray<PrescriptionItemInput>;
  readonly diagnosis?: string | null;
  readonly expected_version: number;
  readonly expires_at: Timestamp | null;
}

export interface CancelPrescriptionRequest {
  readonly reason_code: string;
  readonly expected_version: number;
}

export type NotificationCategory = "account_security" | "appointments" | "consultations" | "messages" | "prescriptions" | "vitals_alerts" | "ai_review" | "delivery" | "dispatch" | "emergency" | "system" | "vitals_update" | UnknownEnumValue;

export type NotificationPriority = "low" | "normal" | "high" | "critical" | UnknownEnumValue;

export interface Notification {
  readonly notification_id: UuidV7;
  readonly category: NotificationCategory;
  readonly resource_type: string;
  readonly resource_id: UuidV7;
  readonly title_code: string;
  readonly body_code: string;
  readonly priority: NotificationPriority;
  readonly expires_at: string;
  readonly read_at: Timestamp | null;
  readonly created_at: Timestamp;
}

export interface NotificationList {
  readonly data: ReadonlyArray<Notification>;
  readonly page: PageInfo;
}

export interface NotificationPreference {
  readonly category: NotificationCategory;
  readonly channel: "in_app" | "push" | "email" | UnknownEnumValue;
  readonly enabled: boolean;
  readonly quiet_hours_start: string | null;
  readonly quiet_hours_end: string | null;
  readonly timezone: string;
}

export interface NotificationPreferenceList {
  readonly data: ReadonlyArray<NotificationPreference>;
}

export interface RegisterPushDeviceRequest {
  readonly platform: "android" | "ios" | "web" | UnknownEnumValue;
  readonly token: string;
}

export interface PushDevice {
  readonly push_device_id: UuidV7;
  readonly platform: "android" | "ios" | "web" | UnknownEnumValue;
  readonly enabled: boolean;
}

export type ReadingSource = "device" | "manual" | "imported" | "derived" | UnknownEnumValue;

export interface TransitionHealthAlertRequest {
  readonly state: "escalated" | "resolved" | "dismissed" | UnknownEnumValue;
  readonly reason_code: string;
  readonly escalated_to_membership_id: UuidV7 | null;
  readonly expected_version: number;
}

export type AiArtifactType = "symptom_summary" | "care_navigation" | "health_summary" | "daily_summary" | "trend_analysis" | "risk_flag" | "forecast" | "anomaly" | UnknownEnumValue;

export type AiReviewStatus = "pending_review" | "approved" | "rejected" | "superseded" | UnknownEnumValue;

export type AiRiskLevel = "unknown" | "low" | "moderate" | "high" | "critical" | UnknownEnumValue;

export interface AiArtifactSource {
  readonly chunk_id: UuidV7;
  readonly rank: number;
}

export interface AiArtifactContent {
  readonly non_diagnostic: true;
  readonly summary_of_reported_symptoms?: ReadonlyArray<string>;
  readonly suggested_next_step?: string;
  readonly information_only_notice?: string;
  readonly sources?: ReadonlyArray<AiArtifactSource>;
}

export interface AiArtifact {
  readonly artifact_id: UuidV7;
  readonly generation_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly artifact_type: AiArtifactType;
  readonly version_no: number;
  readonly review_status: AiReviewStatus;
  readonly risk_level: AiRiskLevel;
  readonly confidence: number | null;
  readonly content: AiArtifactContent;
  readonly model_id: UuidV7;
  readonly prompt_template_id: UuidV7;
  readonly replaces_artifact_id: UuidV7 | null;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface AiConversation {
  readonly conversation_id: UuidV7;
  readonly status: "active" | "completed" | "cancelled" | UnknownEnumValue;
}

export interface SubmitAiTurnRequest {
  readonly content: string;
  readonly artifact_type: "symptom_summary" | "care_navigation" | "health_summary" | "daily_summary" | "trend_analysis" | UnknownEnumValue;
  readonly client_correlation_id: UuidV7;
}

export interface AiGenerationAccepted {
  readonly generation_id: UuidV7;
  readonly sequence_no: number;
  readonly status: "queued";
}

export interface ReviewAiArtifactRequest {
  readonly decision: "approved" | "rejected" | UnknownEnumValue;
  readonly rationale_code: string;
  readonly expected_version: number;
}

export type PharmacyOrderStatus = "received" | "awaiting_validation" | "validated" | "stock_reserved" | "fulfilling" | "ready_for_dispatch" | "dispatched" | "delivered" | "delivery_exception" | "returned" | "rejected" | "cancelled" | UnknownEnumValue;

export interface BatchAvailability {
  readonly batch_id: UuidV7;
  readonly expires_on: string;
  readonly posted_quantity: number;
  readonly reserved_quantity: number;
  readonly available_quantity: number;
}

export interface InventoryAvailability {
  readonly site_id: UuidV7;
  readonly variant_id: UuidV7;
  readonly data: ReadonlyArray<BatchAvailability>;
  readonly total_available_quantity: number;
}

export interface ValidatePharmacyOrderRequest {
  readonly state: "valid" | "invalid" | "needs_clarification" | UnknownEnumValue;
  readonly reason_code: string | null;
  readonly expected_version: number;
}

export interface PharmacyReservationLine {
  readonly batch_id: UuidV7;
  readonly quantity: number;
}

export interface PharmacyValidationResult {
  readonly pharmacy_order_id: UuidV7;
  readonly status: PharmacyOrderStatus;
  readonly reservations: ReadonlyArray<PharmacyReservationLine>;
  readonly shortfall_order_item_ids: ReadonlyArray<UuidV7>;
}

export interface TransitionPharmacyOrderRequest {
  readonly status: "fulfilling" | "ready_for_dispatch" | "cancelled" | UnknownEnumValue;
  readonly reason_code: string | null;
  readonly expected_version: number;
}

export interface PharmacyOrderState {
  readonly pharmacy_order_id: UuidV7;
  readonly status: PharmacyOrderStatus;
}

export interface ExpectedVersionRequest {
  readonly expected_version: number;
}

export interface DispatchOfferSummary {
  readonly offer_id: UuidV7;
  readonly dispatch_job_id: UuidV7;
  readonly fee_sen: number;
  readonly currency: "MYR";
  readonly approx_distance_metres: number | null;
  readonly expires_at: Timestamp;
  readonly version: number;
}

export interface DispatchOfferList {
  readonly data: ReadonlyArray<DispatchOfferSummary>;
}

export interface AcceptDispatchOfferRequest {
  readonly vehicle_id: UuidV7 | null;
  readonly expected_version: number;
}

export interface DispatchAssignmentCreated {
  readonly assignment_id: UuidV7;
  readonly dispatch_job_id: UuidV7;
  readonly status: "assigned";
  readonly version: number;
}

export type DispatchAssignmentStatus = "assigned" | "en_route_pickup" | "arrived_pickup" | "picked_up" | "en_route_dropoff" | "arrived_dropoff" | "completed" | "cancelled" | "failed" | UnknownEnumValue;

export interface AdvanceAssignmentRequest {
  readonly status: "en_route_pickup" | "arrived_pickup" | "picked_up" | "en_route_dropoff" | "arrived_dropoff" | "completed" | "cancelled" | "failed" | UnknownEnumValue;
  readonly reason_code: string | null;
  readonly expected_version: number;
}

export interface DispatchAssignmentState {
  readonly assignment_id: UuidV7;
  readonly status: DispatchAssignmentStatus;
  readonly version: number;
}

export interface DispatchStop {
  readonly kind: "pickup" | "dropoff" | UnknownEnumValue;
  readonly sequence_no: number;
  readonly latitude: string;
  readonly longitude: string;
}

export interface DispatchAssignmentStops {
  readonly assignment_id: UuidV7;
  readonly stops: ReadonlyArray<DispatchStop>;
}

export interface DispatchAssignmentSummary {
  readonly assignment_id: UuidV7;
  readonly dispatch_job_id: UuidV7;
  readonly status: DispatchAssignmentStatus;
  readonly assigned_at: Timestamp;
  readonly completed_at: Timestamp | null;
  readonly fee_sen: number;
  readonly version: number;
}

export interface DispatchAssignmentList {
  readonly data: ReadonlyArray<DispatchAssignmentSummary>;
}

export interface RecipientDisclosure {
  readonly delivery_id: UuidV7;
  readonly recipient_name: string;
  readonly recipient_phone_e164: string;
  readonly address_line1: string;
  readonly address_line2: string | null;
  readonly postcode: string;
  readonly city: string;
  readonly state_code: string;
}

export interface RecordWaypointRequest {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy_metres: number | null;
  readonly significant: boolean;
  readonly recorded_at: Timestamp;
}

export interface WaypointOutcome {
  readonly assignment_id: UuidV7;
  readonly outcome: "stored" | "throttled" | UnknownEnumValue;
}

export interface DriverEarnings {
  readonly driver_id: UuidV7;
  readonly currency: "MYR";
  readonly balance_sen: number;
}

export type ProfileDetailReasonCode = string;

export interface PatientAddress {
  readonly id: UuidV7;
  readonly label: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly postcode: string;
  readonly country_code: string;
  readonly is_primary: boolean;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly version: number;
}

export interface CreatePatientAddressRequest {
  readonly label?: string | null;
  readonly line1: string;
  readonly line2?: string | null;
  readonly city: string;
  readonly state: string;
  readonly postcode: string;
  readonly country_code?: string;
  readonly is_primary?: boolean;
  readonly latitude?: string | null;
  readonly longitude?: string | null;
  readonly reason_code: ProfileDetailReasonCode;
}

export interface UpdatePatientAddressRequest {
  readonly label?: string | null;
  readonly line1: string;
  readonly line2?: string | null;
  readonly city: string;
  readonly state: string;
  readonly postcode: string;
  readonly country_code?: string;
  readonly is_primary?: boolean;
  readonly latitude?: string | null;
  readonly longitude?: string | null;
  readonly reason_code: ProfileDetailReasonCode;
  readonly expected_version: number;
}

export interface EmergencyContact {
  readonly id: UuidV7;
  readonly name: string;
  readonly relationship: string;
  readonly phone_e164: string;
  readonly is_primary: boolean;
  readonly version: number;
}

export interface CreateEmergencyContactRequest {
  readonly name: string;
  readonly relationship: string;
  readonly phone_e164: string;
  readonly is_primary?: boolean;
  readonly reason_code: ProfileDetailReasonCode;
}

export interface UpdateEmergencyContactRequest {
  readonly name: string;
  readonly relationship: string;
  readonly phone_e164: string;
  readonly is_primary?: boolean;
  readonly reason_code: ProfileDetailReasonCode;
  readonly expected_version: number;
}

export interface PatientAllergy {
  readonly id: UuidV7;
  readonly substance: string;
  readonly reaction: string | null;
  readonly severity: "mild" | "moderate" | "severe" | "life_threatening" | UnknownEnumValue;
  readonly recorded_at: Timestamp;
  readonly version: number;
}

export interface CreatePatientAllergyRequest {
  readonly substance: string;
  readonly reaction?: string | null;
  readonly severity: "mild" | "moderate" | "severe" | "life_threatening" | UnknownEnumValue;
  readonly recorded_at?: Timestamp;
  readonly reason_code: ProfileDetailReasonCode;
}

export interface UpdatePatientAllergyRequest {
  readonly substance: string;
  readonly reaction?: string | null;
  readonly severity: "mild" | "moderate" | "severe" | "life_threatening" | UnknownEnumValue;
  readonly recorded_at?: Timestamp;
  readonly reason_code: ProfileDetailReasonCode;
  readonly expected_version: number;
}

export interface PatientCondition {
  readonly id: UuidV7;
  readonly condition_name: string;
  readonly status: "active" | "resolved" | "in_remission" | UnknownEnumValue;
  readonly onset_date: string | null;
  readonly resolved_date: string | null;
  readonly notes: string | null;
  readonly version: number;
}

export interface CreatePatientConditionRequest {
  readonly condition_name: string;
  readonly status: "active" | "resolved" | "in_remission" | UnknownEnumValue;
  readonly onset_date?: string | null;
  readonly resolved_date?: string | null;
  readonly notes?: string | null;
  readonly reason_code: ProfileDetailReasonCode;
}

export interface UpdatePatientConditionRequest {
  readonly condition_name: string;
  readonly status: "active" | "resolved" | "in_remission" | UnknownEnumValue;
  readonly onset_date?: string | null;
  readonly resolved_date?: string | null;
  readonly notes?: string | null;
  readonly reason_code: ProfileDetailReasonCode;
  readonly expected_version: number;
}

export interface DoctorProfessionalDetail {
  readonly membership_id: UuidV7;
  readonly biography: string | null;
  readonly years_experience: number | null;
  readonly consultation_fee_sen: number;
  readonly currency: "MYR";
  readonly accepts_new_patients: boolean;
  readonly specialties: ReadonlyArray<string>;
  readonly languages: ReadonlyArray<string>;
  readonly version: number;
}

export interface PatientAddressList {
  readonly data: ReadonlyArray<PatientAddress>;
}

export interface EmergencyContactList {
  readonly data: ReadonlyArray<EmergencyContact>;
}

export interface PatientAllergyList {
  readonly data: ReadonlyArray<PatientAllergy>;
}

export interface PatientConditionList {
  readonly data: ReadonlyArray<PatientCondition>;
}

export type EmergencyEventStatus = "created" | "triaged" | "dispatching" | "unit_assigned" | "responding" | "on_scene" | "transporting" | "resolved" | "cancelled" | "false_alarm" | UnknownEnumValue;

export type TriagePriority = "unknown" | "low" | "medium" | "high" | "critical" | UnknownEnumValue;

export interface EmergencyVitalSnapshot {
  readonly metric: "heart_rate" | "oxygen_saturation" | "body_temperature" | "blood_pressure" | "systolic_bp" | "diastolic_bp" | "respiratory_rate" | "blood_glucose" | "body_weight" | "ecg_voltage" | UnknownEnumValue;
  readonly value: string;
  readonly unit: string;
  readonly quality: "valid" | "suspect" | "invalid" | "unknown" | UnknownEnumValue;
  readonly measured_at: Timestamp;
}

export interface RaiseEmergencyRequest {
  readonly organization_id: UuidV7;
  readonly site_id?: UuidV7 | null;
  readonly patient_profile_id?: UuidV7 | null;
  readonly category_code: string;
  readonly latitude?: string | null;
  readonly longitude?: string | null;
  readonly address_text?: string | null;
  readonly vitals?: ReadonlyArray<EmergencyVitalSnapshot>;
}

export interface EmergencyEventCreated {
  readonly emergency_event_id: UuidV7;
  readonly status: EmergencyEventStatus;
  readonly triage_priority: TriagePriority;
  readonly version: number;
}

export interface EmergencyEventView {
  readonly emergency_event_id: UuidV7;
  readonly status: EmergencyEventStatus;
  readonly triage_priority: TriagePriority;
  readonly category_code: string;
  readonly version: number;
}

export interface RecordTriageRequest {
  readonly priority: "low" | "medium" | "high" | "critical" | UnknownEnumValue;
  readonly protocol_code: string;
  readonly reason_code: string;
  readonly expected_version: number;
}

export interface TriageRecorded {
  readonly emergency_event_id: UuidV7;
  readonly status: EmergencyEventStatus;
  readonly triage_priority: TriagePriority;
}

export interface ReserveUnitRequest {
  readonly emergency_unit_id: UuidV7;
  readonly manual_override?: boolean;
  readonly override_reason_code?: string | null;
  readonly expected_version: number;
}

export interface EmergencyDispatchCreated {
  readonly emergency_dispatch_id: UuidV7;
  readonly emergency_event_id: UuidV7;
  readonly status: "unit_assigned";
}

export interface AdvanceEmergencyRequest {
  readonly status: "dispatching" | "responding" | "on_scene" | "transporting" | "resolved" | "cancelled" | "false_alarm" | UnknownEnumValue;
  readonly reason_code?: string | null;
  readonly expected_version: number;
}

export interface EmergencyEventState {
  readonly emergency_event_id: UuidV7;
  readonly status: EmergencyEventStatus;
}

export interface ResolveEmergencyRequest {
  readonly resolution_type: "treated_on_scene" | "transported" | "cancelled_by_requester" | "false_alarm" | "duplicate" | "other" | UnknownEnumValue;
  readonly notes: string;
  readonly outcome_code?: string | null;
  readonly expected_version: number;
}

export interface EmergencyResolution {
  readonly emergency_event_id: UuidV7;
  readonly resolution_type: string;
  readonly response_duration_seconds: number;
}

export interface RecordCommunicationRequest {
  readonly channel: "voice" | "sms" | "in_app" | "radio" | UnknownEnumValue;
  readonly direction: "inbound" | "outbound" | UnknownEnumValue;
  readonly summary_code: string;
}

export interface CommunicationRecorded {
  readonly emergency_event_id: UuidV7;
  readonly recorded: true;
}

export interface ActivateBreakGlassRequest {
  readonly emergency_event_id: UuidV7;
  readonly reason_code: string;
  readonly reason_detail?: string | null;
  readonly renews_grant_id?: UuidV7 | null;
  readonly grant_minutes?: number;
}

export interface BreakGlassGrant {
  readonly break_glass_grant_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly expires_at: Timestamp;
}

export interface BreakGlassDisclosure {
  readonly break_glass_grant_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly display_name: string;
  readonly allergies: ReadonlyArray<Readonly<Record<string, unknown>>>;
  readonly active_conditions: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface TerminateBreakGlassRequest {
  readonly reason_code: string;
}

export interface BreakGlassTerminated {
  readonly break_glass_grant_id: UuidV7;
  readonly status: "terminated";
}

export interface ReviewBreakGlassRequest {
  readonly outcome: "justified" | "unjustified" | "inconclusive" | UnknownEnumValue;
  readonly notes: string;
}

export interface BreakGlassReviewed {
  readonly break_glass_grant_id: UuidV7;
  readonly outcome: string;
}

export interface LedgerAccountBalance {
  readonly ledger_account_id: UuidV7;
  readonly account_code: string;
  readonly kind: "asset" | "liability" | "revenue" | "expense" | "equity" | UnknownEnumValue;
  readonly normal_side: "debit" | "credit" | UnknownEnumValue;
  readonly balance_sen: number;
}

export interface LedgerAccountBalanceList {
  readonly organization_id: UuidV7;
  readonly currency: "MYR";
  readonly data: ReadonlyArray<LedgerAccountBalance>;
}

export interface ReverseLedgerEntryRequest {
  readonly memo_code: string;
}

export interface LedgerReversal {
  readonly ledger_entry_id: UuidV7;
  readonly reverses_entry_id: UuidV7;
}

export interface CreatePayoutRunRequest {
  readonly period_start: string;
  readonly period_end: string;
}

export interface PayoutRunCreated {
  readonly payout_run_id: UuidV7;
  readonly status: "draft";
}

export interface AddPayoutItemRequest {
  readonly payee_membership_id: UuidV7;
  readonly gross_sen: number;
  readonly platform_fee_sen: number;
}

export interface PayoutItemCreated {
  readonly payout_item_id: UuidV7;
  readonly net_sen: number;
  readonly status: "pending";
}

export interface AdvancePayoutRunRequest {
  readonly status: "approved" | "processing" | "cancelled" | UnknownEnumValue;
  readonly reason_code?: string | null;
  readonly expected_version: number;
}

export interface PayoutRunState {
  readonly payout_run_id: UuidV7;
  readonly status: "draft" | "approved" | "processing" | "completed" | "partially_failed" | "failed" | "cancelled" | UnknownEnumValue;
}

export interface SettlePayoutItemRequest {
  readonly payable_account_id: UuidV7;
  readonly cash_account_id: UuidV7;
}

export interface PayoutItemSettled {
  readonly payout_item_id: UuidV7;
  readonly status: "paid";
  readonly ledger_entry_id: UuidV7;
}

export interface CreateSupportTicketRequest {
  readonly organization_id: UuidV7;
  readonly category_code: string;
  readonly subject_code: string;
  readonly priority?: "low" | "medium" | "high" | "urgent" | UnknownEnumValue;
  readonly body: string;
}

export interface SupportTicketCreated {
  readonly support_ticket_id: UuidV7;
  readonly status: "open";
}

export interface SupportTicketMessage {
  readonly author_profile_id: UuidV7;
  readonly body: string;
  readonly internal_only: boolean;
  readonly created_at: Timestamp;
}

export interface SupportTicketThread {
  readonly support_ticket_id: UuidV7;
  readonly status: "open" | "assigned" | "in_progress" | "waiting_requester" | "resolved" | "closed" | UnknownEnumValue;
  readonly version: number;
  readonly messages: ReadonlyArray<SupportTicketMessage>;
}

export interface AddSupportTicketMessageRequest {
  readonly body: string;
  readonly internal_only?: boolean;
}

export interface SupportTicketMessageRecorded {
  readonly support_ticket_id: UuidV7;
  readonly recorded: true;
}

export interface AssignSupportTicketRequest {
  readonly assigned_membership_id: UuidV7;
  readonly reason_code: string;
  readonly expected_version: number;
}

export interface AdvanceSupportTicketRequest {
  readonly status: "in_progress" | "waiting_requester" | "resolved" | "closed" | UnknownEnumValue;
  readonly reason_code: string;
  readonly resolution_code?: string | null;
  readonly expected_version: number;
}

export interface SupportTicketState {
  readonly support_ticket_id: UuidV7;
  readonly status: string;
}

export interface RequestExportRequest {
  readonly dataset_code: string;
  readonly purpose_code: string;
}

export interface ExportJobCreated {
  readonly export_job_id: UuidV7;
  readonly status: "queued";
}

export interface ExportJobView {
  readonly export_job_id: UuidV7;
  readonly status: "queued" | "running" | "completed" | "failed" | "expired" | "cancelled" | UnknownEnumValue;
  readonly row_count: number | null;
  readonly downloadable: boolean;
}

export interface OrganizationSetting {
  readonly setting_key: string;
  readonly value: string;
  readonly version: number;
}

export interface OrganizationSettingList {
  readonly organization_id: UuidV7;
  readonly data: ReadonlyArray<OrganizationSetting>;
}

export interface UpdateOrganizationSettingRequest {
  readonly value: string;
  readonly expected_version: number;
}

export interface OrganizationSettingUpdated {
  readonly setting_key: string;
  readonly version: number;
}

export type PurchaseOrderStatus = "draft" | "submitted" | "approved" | "ordered" | "partially_received" | "received" | "cancelled" | UnknownEnumValue;

export interface CreatePurchaseOrderRequest {
  readonly supplier_id: UuidV7;
}

export interface PurchaseOrderCreated {
  readonly purchase_order_id: UuidV7;
  readonly status: "draft";
}

export interface AddPurchaseOrderItemRequest {
  readonly variant_id: UuidV7;
  readonly ordered_quantity: number;
  readonly unit_cost_sen: number;
}

export interface PurchaseOrderItemCreated {
  readonly purchase_order_item_id: UuidV7;
}

export interface AdvancePurchaseOrderRequest {
  readonly status: "submitted" | "approved" | "ordered" | "cancelled" | UnknownEnumValue;
  readonly expected_version: number;
}

export interface PurchaseOrderState {
  readonly purchase_order_id: UuidV7;
  readonly status: PurchaseOrderStatus;
}

export interface ReceiveGoodsRequest {
  readonly variant_id: UuidV7;
  readonly lot_number: string;
  readonly expires_on: string;
  readonly received_quantity: number;
}

export interface GoodsReceiptCreated {
  readonly goods_receipt_id: UuidV7;
  readonly batch_id: UuidV7;
  readonly status: PurchaseOrderStatus;
}

export interface CreateReturnRequest {
  readonly pharmacy_order_id?: UuidV7 | null;
  readonly reason_code: string;
}

export interface ReturnCreated {
  readonly return_id: UuidV7;
  readonly status: "requested";
}

export interface AddReturnItemRequest {
  readonly batch_id: UuidV7;
  readonly quantity: number;
}

export interface ReturnItemCreated {
  readonly return_item_id: UuidV7;
}

export interface AdvanceReturnRequest {
  readonly status: "approved" | "rejected" | "received" | "completed" | "cancelled" | UnknownEnumValue;
  readonly expected_version: number;
}

export interface ReturnState {
  readonly return_id: UuidV7;
  readonly status: "requested" | "approved" | "rejected" | "received" | "completed" | "cancelled" | UnknownEnumValue;
  readonly posted_movements: number;
}

export interface ReconciliationCreated {
  readonly reconciliation_id: UuidV7;
  readonly status: "draft";
  readonly line_count: number;
}

export interface RecordCountRequest {
  readonly batch_id: UuidV7;
  readonly counted_quantity: number;
}

export interface CountRecorded {
  readonly reconciliation_id: UuidV7;
  readonly batch_id: UuidV7;
}

export interface AdvanceReconciliationRequest {
  readonly status: "submitted" | "approved" | "rejected" | "posted" | UnknownEnumValue;
  readonly expected_version: number;
}

export interface ReconciliationState {
  readonly reconciliation_id: UuidV7;
  readonly status: "draft" | "submitted" | "approved" | "posted" | "rejected" | UnknownEnumValue;
  readonly adjustments_posted: number;
}

export type ControlledSubstanceSchedule = "none" | "schedule_2" | "schedule_3" | "schedule_4" | "schedule_5" | UnknownEnumValue;

export interface OpenControlledRegisterRequest {
  readonly variant_id: UuidV7;
}

export interface ControlledRegister {
  readonly register_id: UuidV7;
  readonly schedule: ControlledSubstanceSchedule;
}

export interface RecordControlledMovementRequest {
  readonly batch_id: UuidV7;
  readonly quantity_delta: number;
  readonly reason_code: string;
  readonly witness_profile_id: string;
}

export interface ControlledMovementRecorded {
  readonly cs_event_id: UuidV7;
  readonly movement_id: UuidV7;
  readonly projected_quantity: number;
}

export type WithdrawalStatus = "requested" | "under_review" | "approved" | "processing" | "paid" | "failed" | "rejected" | "cancelled" | UnknownEnumValue;

export interface RegisterBankAccountRequest {
  readonly bank_code: string;
  readonly account_number: string;
}

export interface BankAccountRegistered {
  readonly bank_account_id: UuidV7;
  readonly account_last4: string;
}

export interface RequestWithdrawalRequest {
  readonly bank_account_id: UuidV7;
  readonly amount_sen: number;
}

export interface WithdrawalRequested {
  readonly withdrawal_id: UuidV7;
  readonly status: "requested";
  readonly remaining_sen: number;
}

export interface AdvanceWithdrawalRequest {
  readonly status: "under_review" | "approved" | "processing" | "paid" | "failed" | "rejected" | "cancelled" | UnknownEnumValue;
  readonly reason_code?: string | null;
  readonly payable_account_id?: UuidV7 | null;
  readonly cash_account_id?: UuidV7 | null;
  readonly expected_version: number;
}

export interface WithdrawalState {
  readonly withdrawal_id: UuidV7;
  readonly status: WithdrawalStatus;
  readonly ledger_entry_id: UuidV7 | null;
}

export interface Medication {
  readonly medication_id: UuidV7;
  readonly generic_name: string;
  readonly atc_code: string | null;
  readonly controlled_schedule: ControlledSubstanceSchedule;
  readonly controlled_substance: boolean;
  readonly requires_prescription: boolean;
  readonly retired: boolean;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface MedicationList {
  readonly data: ReadonlyArray<Medication>;
}

export interface CreateMedicationRequest {
  readonly generic_name: string;
  readonly atc_code?: string | null;
  readonly controlled_schedule?: ControlledSubstanceSchedule;
  readonly requires_prescription?: boolean;
}

export interface UpdateMedicationRequest {
  readonly generic_name: string;
  readonly atc_code: string | null;
  readonly controlled_schedule: ControlledSubstanceSchedule;
  readonly requires_prescription: boolean;
  readonly retired: boolean;
  readonly expected_version: number;
}

export interface InventoryBatch {
  readonly batch_id: UuidV7;
  readonly variant_id: UuidV7;
  readonly lot_number: string;
  readonly expires_on: string;
  readonly status: "available" | "quarantined" | "recalled" | "expired" | "depleted" | UnknownEnumValue;
  readonly posted_quantity: number;
  readonly reserved_quantity: number;
  readonly available_quantity: number;
}

export interface InventoryBatchList {
  readonly site_id: UuidV7;
  readonly data: ReadonlyArray<InventoryBatch>;
}

export interface StockMovement {
  readonly movement_id: UuidV7;
  readonly batch_id: UuidV7;
  readonly movement_type: string;
  readonly quantity_delta: number;
  readonly reference_type: string;
  readonly reference_id: UuidV7 | null;
  readonly reason_code: string | null;
  readonly occurred_at: Timestamp;
}

export interface StockMovementList {
  readonly site_id: UuidV7;
  readonly data: ReadonlyArray<StockMovement>;
}

export interface PharmacyOrderItemRequest {
  readonly variant_id: UuidV7;
  readonly quantity: number;
}

export interface CreatePharmacyOrderRequest {
  readonly site_id: UuidV7;
  readonly prescription_id: UuidV7;
  readonly items: ReadonlyArray<PharmacyOrderItemRequest>;
}

export interface PharmacyOrderItem {
  readonly order_item_id: UuidV7;
  readonly variant_id: UuidV7;
  readonly position: number;
  readonly quantity: number;
  readonly unit_price_sen: number;
  readonly currency: "MYR";
}

export interface PharmacyOrder {
  readonly pharmacy_order_id: UuidV7;
  readonly site_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly prescription_id: UuidV7 | null;
  readonly status: PharmacyOrderStatus;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
  readonly items: ReadonlyArray<PharmacyOrderItem>;
}

export interface PharmacyOrderList {
  readonly data: ReadonlyArray<PharmacyOrder>;
}

export interface CreateVehicleRequest {
  readonly plate_number: string;
  readonly vehicle_type: string;
}

export interface UpdateVehicleRequest {
  readonly plate_number: string;
  readonly vehicle_type: string;
  readonly active: boolean;
  readonly expected_version: number;
}

export interface Vehicle {
  readonly vehicle_id: UuidV7;
  readonly plate_number: string;
  readonly vehicle_type: string;
  readonly active: boolean;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface VehicleList {
  readonly data: ReadonlyArray<Vehicle>;
}

export interface CreateDeliveryRatingRequest {
  readonly stars: number;
}

export interface DeliveryRating {
  readonly rating_id: UuidV7;
  readonly delivery_id: UuidV7;
  readonly stars: number;
  readonly created_at: Timestamp;
}

export interface DriverRatingList {
  readonly driver_id: UuidV7;
  readonly average_stars: number | null;
  readonly total_ratings: number;
  readonly data: ReadonlyArray<DeliveryRating>;
}

export interface FaqEntry {
  readonly faq_entry_id: string;
  readonly slug: string;
  readonly question: string;
  readonly answer: string;
  readonly publish_state: "draft" | "published" | "archived" | UnknownEnumValue;
  readonly published_at: string | null;
  readonly version: number;
  readonly updated_at: string;
}

export interface FaqEntryList {
  readonly data: ReadonlyArray<FaqEntry>;
}

export interface CreateFaqEntryRequest {
  readonly slug: string;
  readonly question: string;
  readonly answer: string;
}

export interface UpdateFaqEntryRequest {
  readonly slug: string;
  readonly question: string;
  readonly answer: string;
  readonly expected_version: number;
}

export interface SetFaqPublishStateRequest {
  readonly publish_state: "draft" | "published" | UnknownEnumValue;
  readonly expected_version: number;
}

export interface ArchiveFaqEntryRequest {
  readonly expected_version: number;
}

export interface NotificationTemplate {
  readonly notification_template_id: string;
  readonly template_key: string;
  readonly category: "account_security" | "appointments" | "consultations" | "messages" | "prescriptions" | "vitals_alerts" | "ai_review" | "delivery" | "emergency" | "system" | UnknownEnumValue;
  readonly active_version: number | null;
  readonly updated_at: string;
}

export interface NotificationTemplateList {
  readonly data: ReadonlyArray<NotificationTemplate>;
}

export interface CreateNotificationTemplateRequest {
  readonly template_key: string;
  readonly category: "account_security" | "appointments" | "consultations" | "messages" | "prescriptions" | "vitals_alerts" | "ai_review" | "delivery" | "emergency" | "system" | UnknownEnumValue;
  readonly title_template: string;
  readonly body_template: string;
}

export interface NotificationTemplateVersion {
  readonly notification_template_version_id: string;
  readonly version: number;
  readonly title_template: string;
  readonly body_template: string;
  readonly created_at: string;
}

export interface NotificationTemplateVersionList {
  readonly data: ReadonlyArray<NotificationTemplateVersion>;
}

export interface AddNotificationTemplateVersionRequest {
  readonly title_template: string;
  readonly body_template: string;
}

export interface ActivateNotificationTemplateVersionRequest {
  readonly version: number;
}

export interface NotificationTemplateActiveVersion {
  readonly template_key: string;
  readonly active_version: number;
}

export interface BroadcastMessage {
  readonly broadcast_message_id: string;
  readonly notification_template_version_id: string;
  readonly audience: "all" | "patients" | "staff" | UnknownEnumValue;
  readonly status: string;
  readonly scheduled_at: string | null;
  readonly dispatched_at: string | null;
  readonly version: number;
  readonly created_at: string;
}

export interface BroadcastMessageList {
  readonly data: ReadonlyArray<BroadcastMessage>;
}

export interface CreateBroadcastMessageRequest {
  readonly template_key: string;
  readonly template_version: number;
  readonly audience: "all" | "patients" | "staff" | UnknownEnumValue;
}

export interface ScheduleBroadcastMessageRequest {
  readonly scheduled_at: string;
  readonly expected_version: number;
}

export interface SendBroadcastMessageRequest {
  readonly expected_version: number;
}

export interface BroadcastMessageQueued {
  readonly broadcast_message_id: string;
  readonly status: "scheduled";
  readonly scheduled_at: string;
}

export interface CustomRole {
  readonly custom_role_id: string;
  readonly role_key: string;
  readonly display_name: string;
  readonly base_role_id: "patient" | "doctor" | "driver" | "pharmacy" | "emergency" | "admin" | UnknownEnumValue;
  readonly active: boolean;
  readonly permission_ids: ReadonlyArray<string>;
  readonly version: number;
  readonly updated_at: string;
}

export interface CustomRoleList {
  readonly data: ReadonlyArray<CustomRole>;
}

export interface Permission {
  readonly permission_id: string;
  readonly description: string | null;
}

export interface PermissionList {
  readonly data: ReadonlyArray<Permission>;
}

export interface CreateCustomRoleRequest {
  readonly role_key: string;
  readonly display_name: string;
  readonly base_role_id: "patient" | "doctor" | "driver" | "pharmacy" | "emergency" | "admin" | UnknownEnumValue;
}

export interface UpdateCustomRoleRequest {
  readonly display_name: string;
  readonly active: boolean;
  readonly expected_version: number;
}

export interface ReplaceCustomRolePermissionsRequest {
  readonly permission_ids: ReadonlyArray<string>;
  readonly expected_version: number;
}

export interface CustomRoleVersion {
  readonly custom_role_id: string;
  readonly version: number;
}

export interface AssignMembershipCustomRoleRequest {
  readonly custom_role_id: string | null;
  readonly expected_version: number;
}

export interface MembershipCustomRoleAssigned {
  readonly membership_id: string;
  readonly custom_role_id: string | null;
  readonly version: number;
}

export interface OrganizationSettingVersion {
  readonly version: number;
  readonly value: Readonly<Record<string, unknown>>;
  readonly updated_by_membership_id: string | null;
  readonly created_at: string;
}

export interface OrganizationSettingVersionList {
  readonly setting_key: string;
  readonly data: ReadonlyArray<OrganizationSettingVersion>;
}

export interface PlatformMaintenanceState {
  readonly enabled: boolean;
  readonly reason_code: string | null;
  readonly starts_at: string | null;
  readonly version: number;
  readonly updated_at: string;
}

export interface UpdatePlatformMaintenanceRequest {
  readonly enabled: boolean;
  readonly reason_code: string | null;
  readonly starts_at: string | null;
  readonly expected_version: number;
}

export interface PlatformMaintenanceUpdated {
  readonly enabled: boolean;
  readonly reason_code: string | null;
  readonly starts_at: string | null;
  readonly version: number;
}

export interface ReplayDeadLetterRequest {
  readonly reason_code: string;
}

export interface DeadLetterReplayed {
  readonly event_id: string;
  readonly status: "pending";
  readonly replayed: true;
}

export interface SupportTicketSlaState {
  readonly first_response_due_at: string;
  readonly resolution_due_at: string;
  readonly first_responded_at: string | null;
  readonly first_response_breached: boolean;
  readonly resolution_breached: boolean;
}

export interface SupportTicketSummary {
  readonly support_ticket_id: string;
  readonly category_code: string;
  readonly subject_code: string;
  readonly status: "open" | "assigned" | "in_progress" | "waiting_requester" | "resolved" | "closed" | UnknownEnumValue;
  readonly priority: string;
  readonly requester_profile_id: string;
  readonly assigned_membership_id: string | null;
  readonly resolution_code: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly sla: SupportTicketSlaState;
}

export interface SupportTicketList {
  readonly data: ReadonlyArray<SupportTicketSummary>;
}

export interface EmergencyEventSummary {
  readonly emergency_event_id: string;
  readonly site_id: string | null;
  readonly patient_profile_id: string;
  readonly reported_by_profile_id: string;
  readonly status: "created" | "triaged" | "dispatching" | "unit_assigned" | "responding" | "on_scene" | "transporting" | "resolved" | "cancelled" | "false_alarm" | UnknownEnumValue;
  readonly triage_priority: "unknown" | "low" | "medium" | "high" | "critical" | UnknownEnumValue;
  readonly category_code: string;
  readonly reason_code: string | null;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly address_text: string | null;
  readonly version: number;
  readonly created_at: string;
  readonly triaged_at: string | null;
  readonly dispatched_at: string | null;
  readonly on_scene_at: string | null;
  readonly resolved_at: string | null;
}

export interface EmergencyEventList {
  readonly data: ReadonlyArray<EmergencyEventSummary>;
}

export interface PayoutRunSummary {
  readonly payout_run_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly status: "draft" | "approved" | "processing" | "completed" | "partially_failed" | "failed" | "cancelled" | UnknownEnumValue;
  readonly prepared_by_membership_id: string;
  readonly approved_by_membership_id: string | null;
  readonly reason_code: string | null;
  readonly item_count: number;
  readonly paid_count: number;
  readonly gross_sen: number;
  readonly net_sen: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PayoutRunList {
  readonly currency: "MYR";
  readonly data: ReadonlyArray<PayoutRunSummary>;
}

export interface LedgerEntrySummary {
  readonly ledger_entry_id: string;
  readonly kind: "appointment_payment" | "appointment_refund" | "delivery_fee" | "doctor_payout" | "driver_withdrawal" | "platform_fee" | "adjustment" | "reversal" | UnknownEnumValue;
  readonly reference_type: string;
  readonly reference_id: string;
  readonly memo_code: string;
  readonly reverses_entry_id: string | null;
  readonly amount_sen: number;
  readonly posting_count: number;
  readonly balanced: boolean;
  readonly posted_at: string;
}

export interface LedgerEntryList {
  readonly currency: "MYR";
  readonly data: ReadonlyArray<LedgerEntrySummary>;
}

export interface PurchaseOrderSummary {
  readonly purchase_order_id: string;
  readonly site_id: string;
  readonly supplier_id: string;
  readonly status: "draft" | "submitted" | "approved" | "ordered" | "partially_received" | "received" | "cancelled" | UnknownEnumValue;
  readonly line_count: number;
  readonly ordered_quantity: number;
  readonly received_quantity: number;
  readonly outstanding_quantity: number;
  readonly ordered_total_sen: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface PurchaseOrderList {
  readonly currency: "MYR";
  readonly data: ReadonlyArray<PurchaseOrderSummary>;
}

export interface StockReturnSummary {
  readonly return_id: string;
  readonly site_id: string;
  readonly pharmacy_order_id: string | null;
  readonly status: "requested" | "approved" | "rejected" | "received" | "completed" | "cancelled" | UnknownEnumValue;
  readonly reason_code: string;
  readonly line_count: number;
  readonly total_quantity: number;
  readonly posted_line_count: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface StockReturnList {
  readonly data: ReadonlyArray<StockReturnSummary>;
}

export interface StockReconciliationSummary {
  readonly reconciliation_id: string;
  readonly site_id: string;
  readonly status: "draft" | "submitted" | "approved" | "posted" | "rejected" | UnknownEnumValue;
  readonly counted_by_profile_id: string;
  readonly approved_by_profile_id: string | null;
  readonly line_count: number;
  readonly variance_quantity: number;
  readonly absolute_variance_quantity: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface StockReconciliationList {
  readonly data: ReadonlyArray<StockReconciliationSummary>;
}

export interface AdminAppointmentMetrics {
  readonly total: number;
  readonly starting_within_24h: number;
  readonly active: number;
}

export interface AdminEmergencyMetrics {
  readonly active: number;
}

export interface AdminSupportMetrics {
  readonly open: number;
  readonly breaching_resolution: number;
}

export interface AdminDoctorMetrics {
  readonly listed: number;
  readonly accepting_new_patients: number;
}

export interface AdminRevenueMetrics {
  readonly captured_sen: number;
  readonly currency: "MYR";
  readonly period_start: Timestamp;
}

export interface AdminMetricsGroups {
  readonly appointments?: AdminAppointmentMetrics;
  readonly emergencies?: AdminEmergencyMetrics;
  readonly support?: AdminSupportMetrics;
  readonly doctors?: AdminDoctorMetrics;
  readonly revenue?: AdminRevenueMetrics;
}

export interface AdminMetricsResponse {
  readonly data: AdminMetricsGroups;
  readonly readable_groups: ReadonlyArray<string>;
}

export interface DoctorAssignedPatient {
  readonly profile_id: string;
  readonly display_name: string;
  readonly email: string;
  readonly phone_e164: string | null;
  readonly preferred_locale: string;
  readonly timezone: string;
  readonly status: string;
  readonly assigned_at: string;
}

export interface PrescriptionList {
  readonly data: ReadonlyArray<Prescription>;
  readonly page: PageInfo;
}

export interface ConversationInbox {
  readonly conversation_id: UuidV7;
  readonly consultation_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly status: "active" | "closed" | UnknownEnumValue;
  readonly latest_message_id: UuidV7;
  readonly latest_message_at: Timestamp;
  readonly updated_at: Timestamp;
  readonly unread_count: number;
}

export interface ConversationInboxList {
  readonly data: ReadonlyArray<ConversationInbox>;
  readonly page: PageInfo;
}

export interface DoctorNoteList {
  readonly data: ReadonlyArray<ClinicalNote>;
  readonly page: PageInfo;
}

export interface AiArtifactList {
  readonly data: ReadonlyArray<AiArtifact>;
  readonly page: PageInfo;
}

export interface DoctorDevice {
  readonly id: UuidV7;
  readonly serial_number: string;
  readonly device_type: DeviceType;
  readonly state: DeviceState;
  readonly last_seen_at: Timestamp | null;
  readonly patient_profile_id: UuidV7;
  readonly version: number;
}

export interface DoctorDeviceList {
  readonly data: ReadonlyArray<DoctorDevice>;
  readonly page: PageInfo;
}

export type PayoutItemStatus = "pending" | "paid" | "failed" | "cancelled" | UnknownEnumValue;

export type PayoutRunStatus = "draft" | "approved" | "processing" | "completed" | "partially_failed" | "failed" | "cancelled" | UnknownEnumValue;

export interface DoctorPayoutItem {
  readonly id: UuidV7;
  readonly payout_run_id: UuidV7;
  readonly gross_sen: number;
  readonly platform_fee_sen: number;
  readonly net_sen: number;
  readonly status: PayoutItemStatus;
  readonly ledger_entry_id: UuidV7 | null;
  readonly period_start: string;
  readonly period_end: string;
  readonly run_status: PayoutRunStatus;
  readonly created_at: Timestamp;
}

export interface DoctorEarnings {
  readonly balance_sen: number;
  readonly currency: "MYR";
  readonly total_earned_sen: number;
  readonly data: ReadonlyArray<DoctorPayoutItem>;
  readonly page: PageInfo;
}

export type ClinicalTemplateStatus = "active" | "archived" | UnknownEnumValue;

export type ClinicalTemplateContent = Readonly<Record<string, unknown>>;

export interface ClinicalTemplate {
  readonly template_id: UuidV7;
  readonly author_membership_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly name: string;
  readonly description: string | null;
  readonly specialty: string | null;
  readonly content: ClinicalTemplateContent;
  readonly status: ClinicalTemplateStatus;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface ClinicalTemplateCreateRequest {
  readonly name: string;
  readonly description: string | null;
  readonly specialty: string | null;
  readonly content: ClinicalTemplateContent;
}

export interface ClinicalTemplateUpdateRequest {
  readonly name: string;
  readonly description: string | null;
  readonly specialty: string | null;
  readonly content: ClinicalTemplateContent;
  readonly expected_version: number;
}

export interface ClinicalTemplateList {
  readonly data: ReadonlyArray<ClinicalTemplate>;
  readonly page: PageInfo;
}

export interface DoctorAiAssistantRequest {
  readonly patient_profile_id?: UuidV7;
  readonly consultation_id?: UuidV7;
  readonly prompt: string;
}

export interface DoctorAiAssistantResponse {
  readonly response: string;
  readonly provider: string;
  readonly model: string;
  readonly patient_profile_id: UuidV7 | null;
  readonly consultation_id: UuidV7 | null;
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly latency_ms: number;
  readonly correlation_id: UuidV7;
}

export interface DoctorUpcomingAppointment {
  readonly appointment_id: UuidV7;
  readonly patient_profile_id: UuidV7;
  readonly starts_at: Timestamp;
  readonly status: string;
  readonly mode: string;
}

export interface DoctorDashboardGroups {
  readonly today_appointments?: number;
  readonly upcoming_appointments?: ReadonlyArray<DoctorUpcomingAppointment>;
  readonly assigned_patients?: number;
  readonly pending_notes?: number;
  readonly unread_notifications?: number;
  readonly active_iot_alerts?: number;
}

export interface DoctorDashboardResponse {
  readonly data: DoctorDashboardGroups;
  readonly readable_groups: ReadonlyArray<string>;
}

export interface AppointmentStatusCount {
  readonly status: string;
  readonly count: number;
}

export interface PatientCountPoint {
  readonly period_start: Timestamp;
  readonly period_end: Timestamp;
  readonly count: number;
}

export interface DoctorRatingSummary {
  readonly rating_average: number;
  readonly review_count: number;
}

export interface DoctorMonthlyEarningsProjection {
  readonly projected_sen: number;
  readonly currency: "MYR";
  readonly period_start: Timestamp;
  readonly basis_count: number;
}

export interface DoctorAnalyticsGroups {
  readonly appointment_status_breakdown?: ReadonlyArray<AppointmentStatusCount>;
  readonly patient_count_trend?: ReadonlyArray<PatientCountPoint>;
  readonly rating_summary?: DoctorRatingSummary;
  readonly monthly_earnings_projection?: DoctorMonthlyEarningsProjection;
}

export interface DoctorAnalyticsResponse {
  readonly data: DoctorAnalyticsGroups;
  readonly readable_groups: ReadonlyArray<string>;
}

export type EmergencyUnitStatus = "available" | "reserved" | "en_route" | "on_scene" | "transporting" | "out_of_service" | UnknownEnumValue;

export interface EmergencyUnitSummary {
  readonly emergency_unit_id: string;
  readonly organization_id: string;
  readonly site_id: string;
  readonly call_sign: string;
  readonly unit_type: string;
  readonly status: EmergencyUnitStatus;
  readonly capacity: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface EmergencyUnitList {
  readonly data: ReadonlyArray<EmergencyUnitSummary>;
}

export type FirmwareEventOutcome = "offered" | "downloading" | "installed" | "failed" | "rejected" | UnknownEnumValue;

export type FirmwareRolloutStatus = "draft" | "scheduled" | "active" | "paused" | "completed" | "failed" | "cancelled" | UnknownEnumValue;

export type DeviceHardwareProfile = "smartcura_esp32_v1" | UnknownEnumValue;

export interface FirmwareVersion {
  readonly firmware_version_id: UuidV7;
  readonly hardware_profile: DeviceHardwareProfile;
  readonly version: string;
  readonly sha256: string;
  readonly size_bytes: number;
  readonly released_at: string | null;
  readonly created_at: Timestamp;
}

export interface FirmwareVersionCheck {
  readonly hardware_profile: DeviceHardwareProfile;
  readonly current_version: string | null;
  readonly latest_version: string | null;
  readonly update_available: boolean;
  readonly firmware_version: FirmwareVersion | null;
}

export interface FirmwareDownloadOperation {
  readonly method: "GET" | UnknownEnumValue;
  readonly url: string;
  readonly expires_at: Timestamp;
  readonly required_headers: Readonly<Record<string, unknown>>;
}

export interface FirmwareDownload {
  readonly firmware_version_id: UuidV7;
  readonly version: string;
  readonly sha256: string;
  readonly size_bytes: number;
  readonly download: FirmwareDownloadOperation;
}

export interface CreateFirmwareRolloutRequest {
  readonly firmware_version_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly status: FirmwareRolloutStatus;
  readonly scheduled_at: string | null;
}

export interface FirmwareRollout {
  readonly rollout_id: UuidV7;
  readonly firmware_version_id: UuidV7;
  readonly organization_id: UuidV7;
  readonly status: FirmwareRolloutStatus;
  readonly scheduled_at: string | null;
  readonly version: number;
  readonly created_at: Timestamp;
  readonly updated_at: Timestamp;
}

export interface RecordFirmwareEventRequest {
  readonly firmware_version_id: UuidV7;
  readonly rollout_id: UuidV7 | null;
  readonly outcome: FirmwareEventOutcome;
  readonly detail_code: string | null;
  readonly occurred_at?: string;
}

export interface DeviceFirmwareEvent {
  readonly event_id: UuidV7;
  readonly device_id: UuidV7;
  readonly rollout_id: UuidV7 | null;
  readonly firmware_version_id: UuidV7;
  readonly outcome: FirmwareEventOutcome;
  readonly detail_code: string | null;
  readonly occurred_at: Timestamp;
}
