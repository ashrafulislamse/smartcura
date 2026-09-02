// GENERATED FILE - DO NOT EDIT.
// Source: OpenAPI 3.1.0, contract 0.1.0

typedef UuidV7 = String;

typedef Timestamp = String;

class Money {
  const Money({
    required this.amountSen,
    required this.currency,
  });

  final int amountSen;
  final String currency;

  factory Money.fromJson(Map<String, Object?> json) => Money(
    amountSen: (json['amount_sen'] as num).toInt(),
    currency: json['currency'] as String,
  );

  Map<String, Object?> toJson() => {
    'amount_sen': amountSen,
    'currency': currency,
  };
}

enum RoleId {
  patient,
  doctor,
  driver,
  pharmacy,
  emergency,
  admin,
  superAdmin,
  unknown,
}

extension RoleIdWire on RoleId {
  String get wireValue => switch (this) {
    RoleId.patient => 'patient',
    RoleId.doctor => 'doctor',
    RoleId.driver => 'driver',
    RoleId.pharmacy => 'pharmacy',
    RoleId.emergency => 'emergency',
    RoleId.admin => 'admin',
    RoleId.superAdmin => 'super_admin',
    RoleId.unknown => throw StateError('Cannot serialize unknown RoleId'),
  };
}

RoleId roleIdFromWire(String value) => switch (value) {
  'patient' => RoleId.patient,
  'doctor' => RoleId.doctor,
  'driver' => RoleId.driver,
  'pharmacy' => RoleId.pharmacy,
  'emergency' => RoleId.emergency,
  'admin' => RoleId.admin,
  'super_admin' => RoleId.superAdmin,
  _ => RoleId.unknown,
};

enum ProfileStatus {
  pending,
  active,
  suspended,
  deactivated,
  unknown,
}

extension ProfileStatusWire on ProfileStatus {
  String get wireValue => switch (this) {
    ProfileStatus.pending => 'pending',
    ProfileStatus.active => 'active',
    ProfileStatus.suspended => 'suspended',
    ProfileStatus.deactivated => 'deactivated',
    ProfileStatus.unknown => throw StateError('Cannot serialize unknown ProfileStatus'),
  };
}

ProfileStatus profileStatusFromWire(String value) => switch (value) {
  'pending' => ProfileStatus.pending,
  'active' => ProfileStatus.active,
  'suspended' => ProfileStatus.suspended,
  'deactivated' => ProfileStatus.deactivated,
  _ => ProfileStatus.unknown,
};

enum MembershipStatus {
  applied,
  invited,
  active,
  suspended,
  revoked,
  expired,
  unknown,
}

extension MembershipStatusWire on MembershipStatus {
  String get wireValue => switch (this) {
    MembershipStatus.applied => 'applied',
    MembershipStatus.invited => 'invited',
    MembershipStatus.active => 'active',
    MembershipStatus.suspended => 'suspended',
    MembershipStatus.revoked => 'revoked',
    MembershipStatus.expired => 'expired',
    MembershipStatus.unknown => throw StateError('Cannot serialize unknown MembershipStatus'),
  };
}

MembershipStatus membershipStatusFromWire(String value) => switch (value) {
  'applied' => MembershipStatus.applied,
  'invited' => MembershipStatus.invited,
  'active' => MembershipStatus.active,
  'suspended' => MembershipStatus.suspended,
  'revoked' => MembershipStatus.revoked,
  'expired' => MembershipStatus.expired,
  _ => MembershipStatus.unknown,
};

enum VerificationStatus {
  notSubmitted,
  pendingReview,
  changesRequested,
  approved,
  rejected,
  suspended,
  expired,
  unknown,
}

extension VerificationStatusWire on VerificationStatus {
  String get wireValue => switch (this) {
    VerificationStatus.notSubmitted => 'not_submitted',
    VerificationStatus.pendingReview => 'pending_review',
    VerificationStatus.changesRequested => 'changes_requested',
    VerificationStatus.approved => 'approved',
    VerificationStatus.rejected => 'rejected',
    VerificationStatus.suspended => 'suspended',
    VerificationStatus.expired => 'expired',
    VerificationStatus.unknown => throw StateError('Cannot serialize unknown VerificationStatus'),
  };
}

VerificationStatus verificationStatusFromWire(String value) => switch (value) {
  'not_submitted' => VerificationStatus.notSubmitted,
  'pending_review' => VerificationStatus.pendingReview,
  'changes_requested' => VerificationStatus.changesRequested,
  'approved' => VerificationStatus.approved,
  'rejected' => VerificationStatus.rejected,
  'suspended' => VerificationStatus.suspended,
  'expired' => VerificationStatus.expired,
  _ => VerificationStatus.unknown,
};

enum AppSessionStatus {
  active,
  idleExpired,
  absoluteExpired,
  revoked,
  membershipEnded,
  unknown,
}

extension AppSessionStatusWire on AppSessionStatus {
  String get wireValue => switch (this) {
    AppSessionStatus.active => 'active',
    AppSessionStatus.idleExpired => 'idle_expired',
    AppSessionStatus.absoluteExpired => 'absolute_expired',
    AppSessionStatus.revoked => 'revoked',
    AppSessionStatus.membershipEnded => 'membership_ended',
    AppSessionStatus.unknown => throw StateError('Cannot serialize unknown AppSessionStatus'),
  };
}

AppSessionStatus appSessionStatusFromWire(String value) => switch (value) {
  'active' => AppSessionStatus.active,
  'idle_expired' => AppSessionStatus.idleExpired,
  'absolute_expired' => AppSessionStatus.absoluteExpired,
  'revoked' => AppSessionStatus.revoked,
  'membership_ended' => AppSessionStatus.membershipEnded,
  _ => AppSessionStatus.unknown,
};

enum ClientType {
  patientFlutter,
  doctorFlutter,
  driverFlutter,
  webPortal,
  unknown,
}

extension ClientTypeWire on ClientType {
  String get wireValue => switch (this) {
    ClientType.patientFlutter => 'patient_flutter',
    ClientType.doctorFlutter => 'doctor_flutter',
    ClientType.driverFlutter => 'driver_flutter',
    ClientType.webPortal => 'web_portal',
    ClientType.unknown => throw StateError('Cannot serialize unknown ClientType'),
  };
}

ClientType clientTypeFromWire(String value) => switch (value) {
  'patient_flutter' => ClientType.patientFlutter,
  'doctor_flutter' => ClientType.doctorFlutter,
  'driver_flutter' => ClientType.driverFlutter,
  'web_portal' => ClientType.webPortal,
  _ => ClientType.unknown,
};

enum BootstrapState {
  profileRequired,
  verificationPending,
  roleSelectionRequired,
  ready,
  unknown,
}

extension BootstrapStateWire on BootstrapState {
  String get wireValue => switch (this) {
    BootstrapState.profileRequired => 'profile_required',
    BootstrapState.verificationPending => 'verification_pending',
    BootstrapState.roleSelectionRequired => 'role_selection_required',
    BootstrapState.ready => 'ready',
    BootstrapState.unknown => throw StateError('Cannot serialize unknown BootstrapState'),
  };
}

BootstrapState bootstrapStateFromWire(String value) => switch (value) {
  'profile_required' => BootstrapState.profileRequired,
  'verification_pending' => BootstrapState.verificationPending,
  'role_selection_required' => BootstrapState.roleSelectionRequired,
  'ready' => BootstrapState.ready,
  _ => BootstrapState.unknown,
};

class HealthResponse {
  const HealthResponse({
    required this.status,
    required this.version,
    required this.time,
  });

  final String status;
  final String version;
  final Timestamp time;

  factory HealthResponse.fromJson(Map<String, Object?> json) => HealthResponse(
    status: json['status'] as String,
    version: json['version'] as String,
    time: json['time'] as String,
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'version': version,
    'time': time,
  };
}

class DependencyReadiness {
  const DependencyReadiness({
    required this.name,
    required this.ready,
  });

  final String name;
  final bool ready;

  factory DependencyReadiness.fromJson(Map<String, Object?> json) => DependencyReadiness(
    name: json['name'] as String,
    ready: json['ready'] as bool,
  );

  Map<String, Object?> toJson() => {
    'name': name,
    'ready': ready,
  };
}

class ReadinessResponse {
  const ReadinessResponse({
    required this.status,
    required this.checks,
    required this.time,
  });

  final String status;
  final List<DependencyReadiness> checks;
  final Timestamp time;

  factory ReadinessResponse.fromJson(Map<String, Object?> json) => ReadinessResponse(
    status: json['status'] as String,
    checks: (json['checks'] as List).map((e) => DependencyReadiness.fromJson(e as Map<String, Object?>)).toList(),
    time: json['time'] as String,
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'checks': checks.map((e) => e.toJson()).toList(),
    'time': time,
  };
}

class Profile {
  const Profile({
    required this.id,
    required this.status,
    required this.displayName,
    required this.email,
    required this.phoneE164,
    required this.preferredLocale,
    required this.timezone,
    required this.onboardingCompletedAt,
    required this.avatarUrl,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final ProfileStatus status;
  final String displayName;
  final String email;
  final String? phoneE164;
  final String preferredLocale;
  final String timezone;
  final Timestamp? onboardingCompletedAt;
  final String? avatarUrl;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory Profile.fromJson(Map<String, Object?> json) => Profile(
    id: json['id'] as String,
    status: profileStatusFromWire(json['status'] as String),
    displayName: json['display_name'] as String,
    email: json['email'] as String,
    phoneE164: json['phone_e164'] == null ? null : json['phone_e164'] as String,
    preferredLocale: json['preferred_locale'] as String,
    timezone: json['timezone'] as String,
    onboardingCompletedAt: json['onboarding_completed_at'] == null ? null : json['onboarding_completed_at'] as String,
    avatarUrl: json['avatar_url'] == null ? null : json['avatar_url'] as String,
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'status': status.wireValue,
    'display_name': displayName,
    'email': email,
    'phone_e164': phoneE164,
    'preferred_locale': preferredLocale,
    'timezone': timezone,
    'onboarding_completed_at': onboardingCompletedAt,
    'avatar_url': avatarUrl,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class Membership {
  const Membership({
    required this.id,
    required this.organizationId,
    required this.siteIds,
    required this.role,
    required this.status,
    this.verificationStatus,
    required this.permissions,
  });

  final UuidV7 id;
  final UuidV7 organizationId;
  final List<UuidV7> siteIds;
  final RoleId role;
  final MembershipStatus status;
  final VerificationStatus? verificationStatus;
  final List<String> permissions;

  factory Membership.fromJson(Map<String, Object?> json) => Membership(
    id: json['id'] as String,
    organizationId: json['organization_id'] as String,
    siteIds: List<String>.from(json['site_ids'] as List),
    role: roleIdFromWire(json['role'] as String),
    status: membershipStatusFromWire(json['status'] as String),
    verificationStatus: json['verification_status'] == null ? null : verificationStatusFromWire(json['verification_status'] as String),
    permissions: List<String>.from(json['permissions'] as List),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'organization_id': organizationId,
    'site_ids': siteIds,
    'role': role.wireValue,
    'status': status.wireValue,
    'verification_status': verificationStatus?.wireValue,
    'permissions': permissions,
  };
}

class SessionView {
  const SessionView({
    required this.id,
    required this.status,
    required this.profileId,
    required this.activeRole,
    required this.createdAt,
    required this.lastActivityAt,
    required this.idleExpiresAt,
    required this.absoluteExpiresAt,
    required this.stepUpValidUntil,
  });

  final UuidV7 id;
  final AppSessionStatus status;
  final UuidV7 profileId;
  final RoleId? activeRole;
  final Timestamp createdAt;
  final Timestamp lastActivityAt;
  final Timestamp idleExpiresAt;
  final Timestamp absoluteExpiresAt;
  final Timestamp? stepUpValidUntil;

  factory SessionView.fromJson(Map<String, Object?> json) => SessionView(
    id: json['id'] as String,
    status: appSessionStatusFromWire(json['status'] as String),
    profileId: json['profile_id'] as String,
    activeRole: json['active_role'] == null ? null : roleIdFromWire(json['active_role'] as String),
    createdAt: json['created_at'] as String,
    lastActivityAt: json['last_activity_at'] as String,
    idleExpiresAt: json['idle_expires_at'] as String,
    absoluteExpiresAt: json['absolute_expires_at'] as String,
    stepUpValidUntil: json['step_up_valid_until'] == null ? null : json['step_up_valid_until'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'status': status.wireValue,
    'profile_id': profileId,
    'active_role': activeRole?.wireValue,
    'created_at': createdAt,
    'last_activity_at': lastActivityAt,
    'idle_expires_at': idleExpiresAt,
    'absolute_expires_at': absoluteExpiresAt,
    'step_up_valid_until': stepUpValidUntil,
  };
}

class CreateSessionRequest {
  const CreateSessionRequest({
    required this.clientType,
    required this.deviceName,
    this.requestedRole,
  });

  final ClientType clientType;
  final String deviceName;
  final RoleId? requestedRole;

  factory CreateSessionRequest.fromJson(Map<String, Object?> json) => CreateSessionRequest(
    clientType: clientTypeFromWire(json['client_type'] as String),
    deviceName: json['device_name'] as String,
    requestedRole: json['requested_role'] == null ? null : roleIdFromWire(json['requested_role'] as String),
  );

  Map<String, Object?> toJson() => {
    'client_type': clientType.wireValue,
    'device_name': deviceName,
    'requested_role': requestedRole?.wireValue,
  };
}

class SessionBootstrapResponse {
  const SessionBootstrapResponse({
    required this.bootstrapState,
    required this.csrfToken,
    required this.profile,
    required this.memberships,
    required this.session,
  });

  final BootstrapState bootstrapState;
  final String csrfToken;
  final Profile profile;
  final List<Membership> memberships;
  final SessionView session;

  factory SessionBootstrapResponse.fromJson(Map<String, Object?> json) => SessionBootstrapResponse(
    bootstrapState: bootstrapStateFromWire(json['bootstrap_state'] as String),
    csrfToken: json['csrf_token'] as String,
    profile: Profile.fromJson(json['profile'] as Map<String, Object?>),
    memberships: (json['memberships'] as List).map((e) => Membership.fromJson(e as Map<String, Object?>)).toList(),
    session: SessionView.fromJson(json['session'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'bootstrap_state': bootstrapState.wireValue,
    'csrf_token': csrfToken,
    'profile': profile.toJson(),
    'memberships': memberships.map((e) => e.toJson()).toList(),
    'session': session.toJson(),
  };
}

class SelectActiveRoleRequest {
  const SelectActiveRoleRequest({
    required this.membershipId,
  });

  final UuidV7 membershipId;

  factory SelectActiveRoleRequest.fromJson(Map<String, Object?> json) => SelectActiveRoleRequest(
    membershipId: json['membership_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'membership_id': membershipId,
  };
}

enum StepUpReason {
  roleSwitch,
  prescriptionSign,
  breakGlass,
  controlledSubstance,
  payout,
  withdrawal,
  securityChange,
  dependantAccessChange,
  customRoleChange,
  maintenanceChange,
  deadLetterReplay,
  unknown,
}

extension StepUpReasonWire on StepUpReason {
  String get wireValue => switch (this) {
    StepUpReason.roleSwitch => 'role_switch',
    StepUpReason.prescriptionSign => 'prescription_sign',
    StepUpReason.breakGlass => 'break_glass',
    StepUpReason.controlledSubstance => 'controlled_substance',
    StepUpReason.payout => 'payout',
    StepUpReason.withdrawal => 'withdrawal',
    StepUpReason.securityChange => 'security_change',
    StepUpReason.dependantAccessChange => 'dependant_access_change',
    StepUpReason.customRoleChange => 'custom_role_change',
    StepUpReason.maintenanceChange => 'maintenance_change',
    StepUpReason.deadLetterReplay => 'dead_letter_replay',
    StepUpReason.unknown => throw StateError('Cannot serialize unknown StepUpReason'),
  };
}

StepUpReason stepUpReasonFromWire(String value) => switch (value) {
  'role_switch' => StepUpReason.roleSwitch,
  'prescription_sign' => StepUpReason.prescriptionSign,
  'break_glass' => StepUpReason.breakGlass,
  'controlled_substance' => StepUpReason.controlledSubstance,
  'payout' => StepUpReason.payout,
  'withdrawal' => StepUpReason.withdrawal,
  'security_change' => StepUpReason.securityChange,
  'dependant_access_change' => StepUpReason.dependantAccessChange,
  'custom_role_change' => StepUpReason.customRoleChange,
  'maintenance_change' => StepUpReason.maintenanceChange,
  'dead_letter_replay' => StepUpReason.deadLetterReplay,
  _ => StepUpReason.unknown,
};

class StepUpRequest {
  const StepUpRequest({
    required this.reason,
  });

  final StepUpReason reason;

  factory StepUpRequest.fromJson(Map<String, Object?> json) => StepUpRequest(
    reason: stepUpReasonFromWire(json['reason'] as String),
  );

  Map<String, Object?> toJson() => {
    'reason': reason.wireValue,
  };
}

class StepUpResponse {
  const StepUpResponse({
    required this.sessionId,
    required this.validUntil,
    required this.csrfToken,
  });

  final UuidV7 sessionId;
  final Timestamp validUntil;
  final String csrfToken;

  factory StepUpResponse.fromJson(Map<String, Object?> json) => StepUpResponse(
    sessionId: json['session_id'] as String,
    validUntil: json['valid_until'] as String,
    csrfToken: json['csrf_token'] as String,
  );

  Map<String, Object?> toJson() => {
    'session_id': sessionId,
    'valid_until': validUntil,
    'csrf_token': csrfToken,
  };
}

class MembershipAdministrationView {
  const MembershipAdministrationView({
    required this.id,
    required this.profileId,
    required this.organizationId,
    required this.role,
    required this.status,
    required this.verificationStatus,
    required this.siteIds,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 profileId;
  final UuidV7 organizationId;
  final RoleId role;
  final MembershipStatus status;
  final VerificationStatus? verificationStatus;
  final List<UuidV7> siteIds;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory MembershipAdministrationView.fromJson(Map<String, Object?> json) => MembershipAdministrationView(
    id: json['id'] as String,
    profileId: json['profile_id'] as String,
    organizationId: json['organization_id'] as String,
    role: roleIdFromWire(json['role'] as String),
    status: membershipStatusFromWire(json['status'] as String),
    verificationStatus: json['verification_status'] == null ? null : verificationStatusFromWire(json['verification_status'] as String),
    siteIds: List<String>.from(json['site_ids'] as List),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'profile_id': profileId,
    'organization_id': organizationId,
    'role': role.wireValue,
    'status': status.wireValue,
    'verification_status': verificationStatus?.wireValue,
    'site_ids': siteIds,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class MembershipAdministrationListResponse {
  const MembershipAdministrationListResponse({
    required this.data,
    required this.page,
  });

  final List<MembershipAdministrationView> data;
  final PageInfo page;

  factory MembershipAdministrationListResponse.fromJson(Map<String, Object?> json) => MembershipAdministrationListResponse(
    data: (json['data'] as List).map((e) => MembershipAdministrationView.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class CreateSelfMembershipRequest {
  const CreateSelfMembershipRequest({
    required this.role,
    required this.siteIds,
  });

  final String role;
  final List<UuidV7> siteIds;

  factory CreateSelfMembershipRequest.fromJson(Map<String, Object?> json) => CreateSelfMembershipRequest(
    role: json['role'] as String,
    siteIds: List<String>.from(json['site_ids'] as List),
  );

  Map<String, Object?> toJson() => {
    'role': role,
    'site_ids': siteIds,
  };
}

class CreateMembershipInvitationRequest {
  const CreateMembershipInvitationRequest({
    required this.profileId,
    required this.role,
    required this.siteIds,
  });

  final UuidV7 profileId;
  final String role;
  final List<UuidV7> siteIds;

  factory CreateMembershipInvitationRequest.fromJson(Map<String, Object?> json) => CreateMembershipInvitationRequest(
    profileId: json['profile_id'] as String,
    role: json['role'] as String,
    siteIds: List<String>.from(json['site_ids'] as List),
  );

  Map<String, Object?> toJson() => {
    'profile_id': profileId,
    'role': role,
    'site_ids': siteIds,
  };
}

class TransitionMembershipStatusRequest {
  const TransitionMembershipStatusRequest({
    required this.status,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String status;
  final String reasonCode;
  final int expectedVersion;

  factory TransitionMembershipStatusRequest.fromJson(Map<String, Object?> json) => TransitionMembershipStatusRequest(
    status: json['status'] as String,
    reasonCode: json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class UpdateMyProfileRequest {
  const UpdateMyProfileRequest({
    this.displayName,
    this.phoneE164,
    this.preferredLocale,
    this.timezone,
    this.completeOnboarding,
  });

  final String? displayName;
  final String? phoneE164;
  final String? preferredLocale;
  final String? timezone;
  final bool? completeOnboarding;

  factory UpdateMyProfileRequest.fromJson(Map<String, Object?> json) => UpdateMyProfileRequest(
    displayName: json['display_name'] == null ? null : json['display_name'] as String,
    phoneE164: json['phone_e164'] == null ? null : json['phone_e164'] as String,
    preferredLocale: json['preferred_locale'] == null ? null : json['preferred_locale'] as String,
    timezone: json['timezone'] == null ? null : json['timezone'] as String,
    completeOnboarding: json['complete_onboarding'] == null ? null : json['complete_onboarding'] as bool,
  );

  Map<String, Object?> toJson() => {
    'display_name': displayName,
    'phone_e164': phoneE164,
    'preferred_locale': preferredLocale,
    'timezone': timezone,
    'complete_onboarding': completeOnboarding,
  };
}

typedef Sha256Hex = String;

enum VerificationDocumentKind {
  medicalLicense,
  nationalId,
  drivingLicence,
  vehicleRegistration,
  pharmacyLicence,
  qualificationCertificate,
  professionalIndemnity,
  unknown,
}

extension VerificationDocumentKindWire on VerificationDocumentKind {
  String get wireValue => switch (this) {
    VerificationDocumentKind.medicalLicense => 'medical_license',
    VerificationDocumentKind.nationalId => 'national_id',
    VerificationDocumentKind.drivingLicence => 'driving_licence',
    VerificationDocumentKind.vehicleRegistration => 'vehicle_registration',
    VerificationDocumentKind.pharmacyLicence => 'pharmacy_licence',
    VerificationDocumentKind.qualificationCertificate => 'qualification_certificate',
    VerificationDocumentKind.professionalIndemnity => 'professional_indemnity',
    VerificationDocumentKind.unknown => throw StateError('Cannot serialize unknown VerificationDocumentKind'),
  };
}

VerificationDocumentKind verificationDocumentKindFromWire(String value) => switch (value) {
  'medical_license' => VerificationDocumentKind.medicalLicense,
  'national_id' => VerificationDocumentKind.nationalId,
  'driving_licence' => VerificationDocumentKind.drivingLicence,
  'vehicle_registration' => VerificationDocumentKind.vehicleRegistration,
  'pharmacy_licence' => VerificationDocumentKind.pharmacyLicence,
  'qualification_certificate' => VerificationDocumentKind.qualificationCertificate,
  'professional_indemnity' => VerificationDocumentKind.professionalIndemnity,
  _ => VerificationDocumentKind.unknown,
};

enum VerificationObjectUploadState {
  pending,
  finalized,
  quarantined,
  deleted,
  rejected,
  unknown,
}

extension VerificationObjectUploadStateWire on VerificationObjectUploadState {
  String get wireValue => switch (this) {
    VerificationObjectUploadState.pending => 'pending',
    VerificationObjectUploadState.finalized => 'finalized',
    VerificationObjectUploadState.quarantined => 'quarantined',
    VerificationObjectUploadState.deleted => 'deleted',
    VerificationObjectUploadState.rejected => 'rejected',
    VerificationObjectUploadState.unknown => throw StateError('Cannot serialize unknown VerificationObjectUploadState'),
  };
}

VerificationObjectUploadState verificationObjectUploadStateFromWire(String value) => switch (value) {
  'pending' => VerificationObjectUploadState.pending,
  'finalized' => VerificationObjectUploadState.finalized,
  'quarantined' => VerificationObjectUploadState.quarantined,
  'deleted' => VerificationObjectUploadState.deleted,
  'rejected' => VerificationObjectUploadState.rejected,
  _ => VerificationObjectUploadState.unknown,
};

enum VerificationObjectScanState {
  notScanned,
  scanning,
  clean,
  infected,
  scanFailed,
  unknown,
}

extension VerificationObjectScanStateWire on VerificationObjectScanState {
  String get wireValue => switch (this) {
    VerificationObjectScanState.notScanned => 'not_scanned',
    VerificationObjectScanState.scanning => 'scanning',
    VerificationObjectScanState.clean => 'clean',
    VerificationObjectScanState.infected => 'infected',
    VerificationObjectScanState.scanFailed => 'scan_failed',
    VerificationObjectScanState.unknown => throw StateError('Cannot serialize unknown VerificationObjectScanState'),
  };
}

VerificationObjectScanState verificationObjectScanStateFromWire(String value) => switch (value) {
  'not_scanned' => VerificationObjectScanState.notScanned,
  'scanning' => VerificationObjectScanState.scanning,
  'clean' => VerificationObjectScanState.clean,
  'infected' => VerificationObjectScanState.infected,
  'scan_failed' => VerificationObjectScanState.scanFailed,
  _ => VerificationObjectScanState.unknown,
};

enum VerificationReasonCode {
  documentIllegible,
  documentExpired,
  nameMismatch,
  wrongDocumentType,
  suspectedForgery,
  licenceNotVerifiable,
  approvedVerified,
  administrativeRequest,
  policyViolation,
  unknown,
}

extension VerificationReasonCodeWire on VerificationReasonCode {
  String get wireValue => switch (this) {
    VerificationReasonCode.documentIllegible => 'document_illegible',
    VerificationReasonCode.documentExpired => 'document_expired',
    VerificationReasonCode.nameMismatch => 'name_mismatch',
    VerificationReasonCode.wrongDocumentType => 'wrong_document_type',
    VerificationReasonCode.suspectedForgery => 'suspected_forgery',
    VerificationReasonCode.licenceNotVerifiable => 'licence_not_verifiable',
    VerificationReasonCode.approvedVerified => 'approved_verified',
    VerificationReasonCode.administrativeRequest => 'administrative_request',
    VerificationReasonCode.policyViolation => 'policy_violation',
    VerificationReasonCode.unknown => throw StateError('Cannot serialize unknown VerificationReasonCode'),
  };
}

VerificationReasonCode verificationReasonCodeFromWire(String value) => switch (value) {
  'document_illegible' => VerificationReasonCode.documentIllegible,
  'document_expired' => VerificationReasonCode.documentExpired,
  'name_mismatch' => VerificationReasonCode.nameMismatch,
  'wrong_document_type' => VerificationReasonCode.wrongDocumentType,
  'suspected_forgery' => VerificationReasonCode.suspectedForgery,
  'licence_not_verifiable' => VerificationReasonCode.licenceNotVerifiable,
  'approved_verified' => VerificationReasonCode.approvedVerified,
  'administrative_request' => VerificationReasonCode.administrativeRequest,
  'policy_violation' => VerificationReasonCode.policyViolation,
  _ => VerificationReasonCode.unknown,
};

class VerificationDocumentView {
  const VerificationDocumentView({
    required this.documentId,
    required this.membershipId,
    required this.organizationId,
    required this.objectId,
    required this.documentKind,
    required this.status,
    required this.submittedAt,
    required this.reviewedAt,
    required this.reviewerProfileId,
    required this.reasonCode,
    required this.expiresAt,
    required this.objectKey,
    required this.contentType,
    required this.byteSize,
    required this.declaredSha256,
    required this.verifiedSha256,
    required this.uploadState,
    required this.scanState,
    required this.downloadable,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 documentId;
  final UuidV7 membershipId;
  final UuidV7 organizationId;
  final UuidV7 objectId;
  final VerificationDocumentKind documentKind;
  final VerificationStatus status;
  final Timestamp submittedAt;
  final Timestamp? reviewedAt;
  final UuidV7? reviewerProfileId;
  final VerificationReasonCode? reasonCode;
  final Timestamp? expiresAt;
  final String objectKey;
  final String contentType;
  final int byteSize;
  final Sha256Hex declaredSha256;
  final Sha256Hex? verifiedSha256;
  final VerificationObjectUploadState uploadState;
  final VerificationObjectScanState scanState;
  final bool downloadable;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory VerificationDocumentView.fromJson(Map<String, Object?> json) => VerificationDocumentView(
    documentId: json['document_id'] as String,
    membershipId: json['membership_id'] as String,
    organizationId: json['organization_id'] as String,
    objectId: json['object_id'] as String,
    documentKind: verificationDocumentKindFromWire(json['document_kind'] as String),
    status: verificationStatusFromWire(json['status'] as String),
    submittedAt: json['submitted_at'] as String,
    reviewedAt: json['reviewed_at'] == null ? null : json['reviewed_at'] as String,
    reviewerProfileId: json['reviewer_profile_id'] == null ? null : json['reviewer_profile_id'] as String,
    reasonCode: json['reason_code'] == null ? null : verificationReasonCodeFromWire(json['reason_code'] as String),
    expiresAt: json['expires_at'] == null ? null : json['expires_at'] as String,
    objectKey: json['object_key'] as String,
    contentType: json['content_type'] as String,
    byteSize: (json['byte_size'] as num).toInt(),
    declaredSha256: json['declared_sha256'] as String,
    verifiedSha256: json['verified_sha256'] == null ? null : json['verified_sha256'] as String,
    uploadState: verificationObjectUploadStateFromWire(json['upload_state'] as String),
    scanState: verificationObjectScanStateFromWire(json['scan_state'] as String),
    downloadable: json['downloadable'] as bool,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'document_id': documentId,
    'membership_id': membershipId,
    'organization_id': organizationId,
    'object_id': objectId,
    'document_kind': documentKind.wireValue,
    'status': status.wireValue,
    'submitted_at': submittedAt,
    'reviewed_at': reviewedAt,
    'reviewer_profile_id': reviewerProfileId,
    'reason_code': reasonCode?.wireValue,
    'expires_at': expiresAt,
    'object_key': objectKey,
    'content_type': contentType,
    'byte_size': byteSize,
    'declared_sha256': declaredSha256,
    'verified_sha256': verifiedSha256,
    'upload_state': uploadState.wireValue,
    'scan_state': scanState.wireValue,
    'downloadable': downloadable,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class VerificationDocumentListResponse {
  const VerificationDocumentListResponse({
    required this.data,
  });

  final List<VerificationDocumentView> data;

  factory VerificationDocumentListResponse.fromJson(Map<String, Object?> json) => VerificationDocumentListResponse(
    data: (json['data'] as List).map((e) => VerificationDocumentView.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class RequestVerificationUploadRequest {
  const RequestVerificationUploadRequest({
    required this.documentKind,
    required this.contentType,
    required this.byteSize,
    required this.declaredSha256,
    this.documentExpiresAt,
  });

  final VerificationDocumentKind documentKind;
  final String contentType;
  final int byteSize;
  final Sha256Hex declaredSha256;
  final Timestamp? documentExpiresAt;

  factory RequestVerificationUploadRequest.fromJson(Map<String, Object?> json) => RequestVerificationUploadRequest(
    documentKind: verificationDocumentKindFromWire(json['document_kind'] as String),
    contentType: json['content_type'] as String,
    byteSize: (json['byte_size'] as num).toInt(),
    declaredSha256: json['declared_sha256'] as String,
    documentExpiresAt: json['document_expires_at'] == null ? null : json['document_expires_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'document_kind': documentKind.wireValue,
    'content_type': contentType,
    'byte_size': byteSize,
    'declared_sha256': declaredSha256,
    'document_expires_at': documentExpiresAt,
  };
}

class VerificationUploadTarget {
  const VerificationUploadTarget({
    required this.method,
    required this.url,
    required this.expiresAt,
    required this.requiredHeaders,
  });

  final String method;
  final String url;
  final Timestamp expiresAt;
  final Map<String, Object?> requiredHeaders;

  factory VerificationUploadTarget.fromJson(Map<String, Object?> json) => VerificationUploadTarget(
    method: json['method'] as String,
    url: json['url'] as String,
    expiresAt: json['expires_at'] as String,
    requiredHeaders: Map<String, Object?>.from(json['required_headers'] as Map),
  );

  Map<String, Object?> toJson() => {
    'method': method,
    'url': url,
    'expires_at': expiresAt,
    'required_headers': requiredHeaders,
  };
}

class RequestVerificationUploadResponse {
  const RequestVerificationUploadResponse({
    required this.document,
    required this.upload,
  });

  final VerificationDocumentView document;
  final VerificationUploadTarget upload;

  factory RequestVerificationUploadResponse.fromJson(Map<String, Object?> json) => RequestVerificationUploadResponse(
    document: VerificationDocumentView.fromJson(json['document'] as Map<String, Object?>),
    upload: VerificationUploadTarget.fromJson(json['upload'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'document': document.toJson(),
    'upload': upload.toJson(),
  };
}

class FinalizeVerificationDocumentRequest {
  const FinalizeVerificationDocumentRequest({
    required this.reportedSha256,
  });

  final String reportedSha256;

  factory FinalizeVerificationDocumentRequest.fromJson(Map<String, Object?> json) => FinalizeVerificationDocumentRequest(
    reportedSha256: json['reported_sha256'] as String,
  );

  Map<String, Object?> toJson() => {
    'reported_sha256': reportedSha256,
  };
}

class ReviewVerificationDocumentRequest {
  const ReviewVerificationDocumentRequest({
    required this.status,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String status;
  final VerificationReasonCode reasonCode;
  final int expectedVersion;

  factory ReviewVerificationDocumentRequest.fromJson(Map<String, Object?> json) => ReviewVerificationDocumentRequest(
    status: json['status'] as String,
    reasonCode: verificationReasonCodeFromWire(json['reason_code'] as String),
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode.wireValue,
    'expected_version': expectedVersion,
  };
}

class PageInfo {
  const PageInfo({
    required this.hasMore,
    required this.nextCursor,
  });

  final bool hasMore;
  final String? nextCursor;

  factory PageInfo.fromJson(Map<String, Object?> json) => PageInfo(
    hasMore: json['has_more'] as bool,
    nextCursor: json['next_cursor'] == null ? null : json['next_cursor'] as String,
  );

  Map<String, Object?> toJson() => {
    'has_more': hasMore,
    'next_cursor': nextCursor,
  };
}

typedef LocalTime = String;

typedef CalendarDate = String;

enum AppointmentMode {
  video,
  audio,
  chat,
  inPerson,
  unknown,
}

extension AppointmentModeWire on AppointmentMode {
  String get wireValue => switch (this) {
    AppointmentMode.video => 'video',
    AppointmentMode.audio => 'audio',
    AppointmentMode.chat => 'chat',
    AppointmentMode.inPerson => 'in_person',
    AppointmentMode.unknown => throw StateError('Cannot serialize unknown AppointmentMode'),
  };
}

AppointmentMode appointmentModeFromWire(String value) => switch (value) {
  'video' => AppointmentMode.video,
  'audio' => AppointmentMode.audio,
  'chat' => AppointmentMode.chat,
  'in_person' => AppointmentMode.inPerson,
  _ => AppointmentMode.unknown,
};

enum AppointmentStatus {
  pendingPayment,
  confirmed,
  checkedIn,
  inProgress,
  cancelled,
  completed,
  noShow,
  rescheduled,
  unknown,
}

extension AppointmentStatusWire on AppointmentStatus {
  String get wireValue => switch (this) {
    AppointmentStatus.pendingPayment => 'pending_payment',
    AppointmentStatus.confirmed => 'confirmed',
    AppointmentStatus.checkedIn => 'checked_in',
    AppointmentStatus.inProgress => 'in_progress',
    AppointmentStatus.cancelled => 'cancelled',
    AppointmentStatus.completed => 'completed',
    AppointmentStatus.noShow => 'no_show',
    AppointmentStatus.rescheduled => 'rescheduled',
    AppointmentStatus.unknown => throw StateError('Cannot serialize unknown AppointmentStatus'),
  };
}

AppointmentStatus appointmentStatusFromWire(String value) => switch (value) {
  'pending_payment' => AppointmentStatus.pendingPayment,
  'confirmed' => AppointmentStatus.confirmed,
  'checked_in' => AppointmentStatus.checkedIn,
  'in_progress' => AppointmentStatus.inProgress,
  'cancelled' => AppointmentStatus.cancelled,
  'completed' => AppointmentStatus.completed,
  'no_show' => AppointmentStatus.noShow,
  'rescheduled' => AppointmentStatus.rescheduled,
  _ => AppointmentStatus.unknown,
};

enum AppointmentPaymentState {
  pending,
  captured,
  refunded,
  failed,
  unknown,
}

extension AppointmentPaymentStateWire on AppointmentPaymentState {
  String get wireValue => switch (this) {
    AppointmentPaymentState.pending => 'pending',
    AppointmentPaymentState.captured => 'captured',
    AppointmentPaymentState.refunded => 'refunded',
    AppointmentPaymentState.failed => 'failed',
    AppointmentPaymentState.unknown => throw StateError('Cannot serialize unknown AppointmentPaymentState'),
  };
}

AppointmentPaymentState appointmentPaymentStateFromWire(String value) => switch (value) {
  'pending' => AppointmentPaymentState.pending,
  'captured' => AppointmentPaymentState.captured,
  'refunded' => AppointmentPaymentState.refunded,
  'failed' => AppointmentPaymentState.failed,
  _ => AppointmentPaymentState.unknown,
};

enum AppointmentCancellationReasonCode {
  patientRequest,
  doctorUnavailable,
  scheduleConflict,
  paymentExpired,
  duplicateBooking,
  clinicalReason,
  administrativeAction,
  unknown,
}

extension AppointmentCancellationReasonCodeWire on AppointmentCancellationReasonCode {
  String get wireValue => switch (this) {
    AppointmentCancellationReasonCode.patientRequest => 'patient_request',
    AppointmentCancellationReasonCode.doctorUnavailable => 'doctor_unavailable',
    AppointmentCancellationReasonCode.scheduleConflict => 'schedule_conflict',
    AppointmentCancellationReasonCode.paymentExpired => 'payment_expired',
    AppointmentCancellationReasonCode.duplicateBooking => 'duplicate_booking',
    AppointmentCancellationReasonCode.clinicalReason => 'clinical_reason',
    AppointmentCancellationReasonCode.administrativeAction => 'administrative_action',
    AppointmentCancellationReasonCode.unknown => throw StateError('Cannot serialize unknown AppointmentCancellationReasonCode'),
  };
}

AppointmentCancellationReasonCode appointmentCancellationReasonCodeFromWire(String value) => switch (value) {
  'patient_request' => AppointmentCancellationReasonCode.patientRequest,
  'doctor_unavailable' => AppointmentCancellationReasonCode.doctorUnavailable,
  'schedule_conflict' => AppointmentCancellationReasonCode.scheduleConflict,
  'payment_expired' => AppointmentCancellationReasonCode.paymentExpired,
  'duplicate_booking' => AppointmentCancellationReasonCode.duplicateBooking,
  'clinical_reason' => AppointmentCancellationReasonCode.clinicalReason,
  'administrative_action' => AppointmentCancellationReasonCode.administrativeAction,
  _ => AppointmentCancellationReasonCode.unknown,
};

enum AppointmentNoShowReasonCode {
  patientAbsent,
  patientLate,
  patientUnreachable,
  unknown,
}

extension AppointmentNoShowReasonCodeWire on AppointmentNoShowReasonCode {
  String get wireValue => switch (this) {
    AppointmentNoShowReasonCode.patientAbsent => 'patient_absent',
    AppointmentNoShowReasonCode.patientLate => 'patient_late',
    AppointmentNoShowReasonCode.patientUnreachable => 'patient_unreachable',
    AppointmentNoShowReasonCode.unknown => throw StateError('Cannot serialize unknown AppointmentNoShowReasonCode'),
  };
}

AppointmentNoShowReasonCode appointmentNoShowReasonCodeFromWire(String value) => switch (value) {
  'patient_absent' => AppointmentNoShowReasonCode.patientAbsent,
  'patient_late' => AppointmentNoShowReasonCode.patientLate,
  'patient_unreachable' => AppointmentNoShowReasonCode.patientUnreachable,
  _ => AppointmentNoShowReasonCode.unknown,
};

enum AppointmentReasonCode {
  patientRequest,
  doctorUnavailable,
  scheduleConflict,
  paymentExpired,
  duplicateBooking,
  clinicalReason,
  administrativeAction,
  patientAbsent,
  patientLate,
  patientUnreachable,
  rescheduled,
  unknown,
}

extension AppointmentReasonCodeWire on AppointmentReasonCode {
  String get wireValue => switch (this) {
    AppointmentReasonCode.patientRequest => 'patient_request',
    AppointmentReasonCode.doctorUnavailable => 'doctor_unavailable',
    AppointmentReasonCode.scheduleConflict => 'schedule_conflict',
    AppointmentReasonCode.paymentExpired => 'payment_expired',
    AppointmentReasonCode.duplicateBooking => 'duplicate_booking',
    AppointmentReasonCode.clinicalReason => 'clinical_reason',
    AppointmentReasonCode.administrativeAction => 'administrative_action',
    AppointmentReasonCode.patientAbsent => 'patient_absent',
    AppointmentReasonCode.patientLate => 'patient_late',
    AppointmentReasonCode.patientUnreachable => 'patient_unreachable',
    AppointmentReasonCode.rescheduled => 'rescheduled',
    AppointmentReasonCode.unknown => throw StateError('Cannot serialize unknown AppointmentReasonCode'),
  };
}

AppointmentReasonCode appointmentReasonCodeFromWire(String value) => switch (value) {
  'patient_request' => AppointmentReasonCode.patientRequest,
  'doctor_unavailable' => AppointmentReasonCode.doctorUnavailable,
  'schedule_conflict' => AppointmentReasonCode.scheduleConflict,
  'payment_expired' => AppointmentReasonCode.paymentExpired,
  'duplicate_booking' => AppointmentReasonCode.duplicateBooking,
  'clinical_reason' => AppointmentReasonCode.clinicalReason,
  'administrative_action' => AppointmentReasonCode.administrativeAction,
  'patient_absent' => AppointmentReasonCode.patientAbsent,
  'patient_late' => AppointmentReasonCode.patientLate,
  'patient_unreachable' => AppointmentReasonCode.patientUnreachable,
  'rescheduled' => AppointmentReasonCode.rescheduled,
  _ => AppointmentReasonCode.unknown,
};

enum AvailabilityExceptionReasonCode {
  annualLeave,
  sickLeave,
  publicHoliday,
  training,
  administrativeBlock,
  clinicClosure,
  scheduleCorrection,
  emergencyCover,
  unknown,
}

extension AvailabilityExceptionReasonCodeWire on AvailabilityExceptionReasonCode {
  String get wireValue => switch (this) {
    AvailabilityExceptionReasonCode.annualLeave => 'annual_leave',
    AvailabilityExceptionReasonCode.sickLeave => 'sick_leave',
    AvailabilityExceptionReasonCode.publicHoliday => 'public_holiday',
    AvailabilityExceptionReasonCode.training => 'training',
    AvailabilityExceptionReasonCode.administrativeBlock => 'administrative_block',
    AvailabilityExceptionReasonCode.clinicClosure => 'clinic_closure',
    AvailabilityExceptionReasonCode.scheduleCorrection => 'schedule_correction',
    AvailabilityExceptionReasonCode.emergencyCover => 'emergency_cover',
    AvailabilityExceptionReasonCode.unknown => throw StateError('Cannot serialize unknown AvailabilityExceptionReasonCode'),
  };
}

AvailabilityExceptionReasonCode availabilityExceptionReasonCodeFromWire(String value) => switch (value) {
  'annual_leave' => AvailabilityExceptionReasonCode.annualLeave,
  'sick_leave' => AvailabilityExceptionReasonCode.sickLeave,
  'public_holiday' => AvailabilityExceptionReasonCode.publicHoliday,
  'training' => AvailabilityExceptionReasonCode.training,
  'administrative_block' => AvailabilityExceptionReasonCode.administrativeBlock,
  'clinic_closure' => AvailabilityExceptionReasonCode.clinicClosure,
  'schedule_correction' => AvailabilityExceptionReasonCode.scheduleCorrection,
  'emergency_cover' => AvailabilityExceptionReasonCode.emergencyCover,
  _ => AvailabilityExceptionReasonCode.unknown,
};

class AvailabilityRuleInput {
  const AvailabilityRuleInput({
    required this.weekday,
    required this.startTime,
    required this.endTime,
    required this.slotDurationMinutes,
    required this.timezone,
    required this.effectiveFrom,
    this.effectiveTo,
  });

  final int weekday;
  final LocalTime startTime;
  final String endTime;
  final int slotDurationMinutes;
  final String timezone;
  final CalendarDate effectiveFrom;
  final CalendarDate? effectiveTo;

  factory AvailabilityRuleInput.fromJson(Map<String, Object?> json) => AvailabilityRuleInput(
    weekday: (json['weekday'] as num).toInt(),
    startTime: json['start_time'] as String,
    endTime: json['end_time'] as String,
    slotDurationMinutes: (json['slot_duration_minutes'] as num).toInt(),
    timezone: json['timezone'] as String,
    effectiveFrom: json['effective_from'] as String,
    effectiveTo: json['effective_to'] == null ? null : json['effective_to'] as String,
  );

  Map<String, Object?> toJson() => {
    'weekday': weekday,
    'start_time': startTime,
    'end_time': endTime,
    'slot_duration_minutes': slotDurationMinutes,
    'timezone': timezone,
    'effective_from': effectiveFrom,
    'effective_to': effectiveTo,
  };
}

class AvailabilityRule {
  const AvailabilityRule({
    required this.id,
    required this.membershipId,
    required this.organizationId,
    required this.weekday,
    required this.startTime,
    required this.endTime,
    required this.slotDurationMinutes,
    required this.timezone,
    required this.effectiveFrom,
    required this.effectiveTo,
    required this.isActive,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 membershipId;
  final UuidV7 organizationId;
  final int weekday;
  final LocalTime startTime;
  final LocalTime endTime;
  final int slotDurationMinutes;
  final String timezone;
  final CalendarDate effectiveFrom;
  final CalendarDate? effectiveTo;
  final bool isActive;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory AvailabilityRule.fromJson(Map<String, Object?> json) => AvailabilityRule(
    id: json['id'] as String,
    membershipId: json['membership_id'] as String,
    organizationId: json['organization_id'] as String,
    weekday: (json['weekday'] as num).toInt(),
    startTime: json['start_time'] as String,
    endTime: json['end_time'] as String,
    slotDurationMinutes: (json['slot_duration_minutes'] as num).toInt(),
    timezone: json['timezone'] as String,
    effectiveFrom: json['effective_from'] as String,
    effectiveTo: json['effective_to'] == null ? null : json['effective_to'] as String,
    isActive: json['is_active'] as bool,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'membership_id': membershipId,
    'organization_id': organizationId,
    'weekday': weekday,
    'start_time': startTime,
    'end_time': endTime,
    'slot_duration_minutes': slotDurationMinutes,
    'timezone': timezone,
    'effective_from': effectiveFrom,
    'effective_to': effectiveTo,
    'is_active': isActive,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class AvailabilityRuleSetResponse {
  const AvailabilityRuleSetResponse({
    required this.data,
    required this.version,
  });

  final List<AvailabilityRule> data;
  final int version;

  factory AvailabilityRuleSetResponse.fromJson(Map<String, Object?> json) => AvailabilityRuleSetResponse(
    data: (json['data'] as List).map((e) => AvailabilityRule.fromJson(e as Map<String, Object?>)).toList(),
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'version': version,
  };
}

class ReplaceAvailabilityRulesRequest {
  const ReplaceAvailabilityRulesRequest({
    required this.rules,
    required this.expectedVersion,
    this.horizonDays,
  });

  final List<AvailabilityRuleInput> rules;
  final int expectedVersion;
  final int? horizonDays;

  factory ReplaceAvailabilityRulesRequest.fromJson(Map<String, Object?> json) => ReplaceAvailabilityRulesRequest(
    rules: (json['rules'] as List).map((e) => AvailabilityRuleInput.fromJson(e as Map<String, Object?>)).toList(),
    expectedVersion: (json['expected_version'] as num).toInt(),
    horizonDays: json['horizon_days'] == null ? null : (json['horizon_days'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'rules': rules.map((e) => e.toJson()).toList(),
    'expected_version': expectedVersion,
    'horizon_days': horizonDays,
  };
}

class AvailabilityRulesResponse {
  const AvailabilityRulesResponse({
    required this.data,
    required this.version,
    required this.generatedSlotCount,
  });

  final List<AvailabilityRule> data;
  final int version;
  final int generatedSlotCount;

  factory AvailabilityRulesResponse.fromJson(Map<String, Object?> json) => AvailabilityRulesResponse(
    data: (json['data'] as List).map((e) => AvailabilityRule.fromJson(e as Map<String, Object?>)).toList(),
    version: (json['version'] as num).toInt(),
    generatedSlotCount: (json['generated_slot_count'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'version': version,
    'generated_slot_count': generatedSlotCount,
  };
}

class RecordAvailabilityExceptionRequest {
  const RecordAvailabilityExceptionRequest({
    required this.exceptionDate,
    required this.isUnavailable,
    this.replacementStartTime,
    this.replacementEndTime,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final CalendarDate exceptionDate;
  final bool isUnavailable;
  final LocalTime? replacementStartTime;
  final LocalTime? replacementEndTime;
  final AvailabilityExceptionReasonCode reasonCode;
  final int expectedVersion;

  factory RecordAvailabilityExceptionRequest.fromJson(Map<String, Object?> json) => RecordAvailabilityExceptionRequest(
    exceptionDate: json['exception_date'] as String,
    isUnavailable: json['is_unavailable'] as bool,
    replacementStartTime: json['replacement_start_time'] == null ? null : json['replacement_start_time'] as String,
    replacementEndTime: json['replacement_end_time'] == null ? null : json['replacement_end_time'] as String,
    reasonCode: availabilityExceptionReasonCodeFromWire(json['reason_code'] as String),
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'exception_date': exceptionDate,
    'is_unavailable': isUnavailable,
    'replacement_start_time': replacementStartTime,
    'replacement_end_time': replacementEndTime,
    'reason_code': reasonCode.wireValue,
    'expected_version': expectedVersion,
  };
}

class AvailabilityException {
  const AvailabilityException({
    required this.id,
    required this.membershipId,
    required this.organizationId,
    required this.exceptionDate,
    required this.isUnavailable,
    required this.replacementStartTime,
    required this.replacementEndTime,
    required this.reasonCode,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 membershipId;
  final UuidV7 organizationId;
  final CalendarDate exceptionDate;
  final bool isUnavailable;
  final LocalTime? replacementStartTime;
  final LocalTime? replacementEndTime;
  final AvailabilityExceptionReasonCode reasonCode;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory AvailabilityException.fromJson(Map<String, Object?> json) => AvailabilityException(
    id: json['id'] as String,
    membershipId: json['membership_id'] as String,
    organizationId: json['organization_id'] as String,
    exceptionDate: json['exception_date'] as String,
    isUnavailable: json['is_unavailable'] as bool,
    replacementStartTime: json['replacement_start_time'] == null ? null : json['replacement_start_time'] as String,
    replacementEndTime: json['replacement_end_time'] == null ? null : json['replacement_end_time'] as String,
    reasonCode: availabilityExceptionReasonCodeFromWire(json['reason_code'] as String),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'membership_id': membershipId,
    'organization_id': organizationId,
    'exception_date': exceptionDate,
    'is_unavailable': isUnavailable,
    'replacement_start_time': replacementStartTime,
    'replacement_end_time': replacementEndTime,
    'reason_code': reasonCode.wireValue,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class AvailabilityExceptionResponse {
  const AvailabilityExceptionResponse({
    required this.data,
    required this.closedSlotCount,
    required this.generatedSlotCount,
  });

  final AvailabilityException data;
  final int closedSlotCount;
  final int generatedSlotCount;

  factory AvailabilityExceptionResponse.fromJson(Map<String, Object?> json) => AvailabilityExceptionResponse(
    data: AvailabilityException.fromJson(json['data'] as Map<String, Object?>),
    closedSlotCount: (json['closed_slot_count'] as num).toInt(),
    generatedSlotCount: (json['generated_slot_count'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'data': data.toJson(),
    'closed_slot_count': closedSlotCount,
    'generated_slot_count': generatedSlotCount,
  };
}

class GenerateAvailabilitySlotsRequest {
  const GenerateAvailabilitySlotsRequest({
    required this.fromDate,
    required this.toDate,
  });

  final CalendarDate fromDate;
  final String toDate;

  factory GenerateAvailabilitySlotsRequest.fromJson(Map<String, Object?> json) => GenerateAvailabilitySlotsRequest(
    fromDate: json['from_date'] as String,
    toDate: json['to_date'] as String,
  );

  Map<String, Object?> toJson() => {
    'from_date': fromDate,
    'to_date': toDate,
  };
}

class AvailabilitySlotGenerationResponse {
  const AvailabilitySlotGenerationResponse({
    required this.membershipId,
    required this.organizationId,
    required this.fromDate,
    required this.toDate,
    required this.generatedSlotCount,
    required this.version,
  });

  final UuidV7 membershipId;
  final UuidV7 organizationId;
  final CalendarDate fromDate;
  final CalendarDate toDate;
  final int generatedSlotCount;
  final int version;

  factory AvailabilitySlotGenerationResponse.fromJson(Map<String, Object?> json) => AvailabilitySlotGenerationResponse(
    membershipId: json['membership_id'] as String,
    organizationId: json['organization_id'] as String,
    fromDate: json['from_date'] as String,
    toDate: json['to_date'] as String,
    generatedSlotCount: (json['generated_slot_count'] as num).toInt(),
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'membership_id': membershipId,
    'organization_id': organizationId,
    'from_date': fromDate,
    'to_date': toDate,
    'generated_slot_count': generatedSlotCount,
    'version': version,
  };
}

class AvailabilitySlot {
  const AvailabilitySlot({
    required this.id,
    required this.membershipId,
    required this.organizationId,
    required this.startsAt,
    required this.endsAt,
    required this.state,
    required this.version,
  });

  final UuidV7 id;
  final UuidV7 membershipId;
  final UuidV7 organizationId;
  final Timestamp startsAt;
  final Timestamp endsAt;
  final String state;
  final int version;

  factory AvailabilitySlot.fromJson(Map<String, Object?> json) => AvailabilitySlot(
    id: json['id'] as String,
    membershipId: json['membership_id'] as String,
    organizationId: json['organization_id'] as String,
    startsAt: json['starts_at'] as String,
    endsAt: json['ends_at'] as String,
    state: json['state'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'membership_id': membershipId,
    'organization_id': organizationId,
    'starts_at': startsAt,
    'ends_at': endsAt,
    'state': state,
    'version': version,
  };
}

class AvailabilitySlotListResponse {
  const AvailabilitySlotListResponse({
    required this.data,
    required this.page,
  });

  final List<AvailabilitySlot> data;
  final PageInfo page;

  factory AvailabilitySlotListResponse.fromJson(Map<String, Object?> json) => AvailabilitySlotListResponse(
    data: (json['data'] as List).map((e) => AvailabilitySlot.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class SlotHold {
  const SlotHold({
    required this.slotId,
    required this.membershipId,
    required this.organizationId,
    required this.startsAt,
    required this.endsAt,
    required this.heldUntil,
    required this.version,
  });

  final UuidV7 slotId;
  final UuidV7 membershipId;
  final UuidV7 organizationId;
  final Timestamp startsAt;
  final Timestamp endsAt;
  final Timestamp heldUntil;
  final int version;

  factory SlotHold.fromJson(Map<String, Object?> json) => SlotHold(
    slotId: json['slot_id'] as String,
    membershipId: json['membership_id'] as String,
    organizationId: json['organization_id'] as String,
    startsAt: json['starts_at'] as String,
    endsAt: json['ends_at'] as String,
    heldUntil: json['held_until'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'slot_id': slotId,
    'membership_id': membershipId,
    'organization_id': organizationId,
    'starts_at': startsAt,
    'ends_at': endsAt,
    'held_until': heldUntil,
    'version': version,
  };
}

class BookAppointmentRequest {
  const BookAppointmentRequest({
    required this.slotId,
    required this.mode,
  });

  final UuidV7 slotId;
  final AppointmentMode mode;

  factory BookAppointmentRequest.fromJson(Map<String, Object?> json) => BookAppointmentRequest(
    slotId: json['slot_id'] as String,
    mode: appointmentModeFromWire(json['mode'] as String),
  );

  Map<String, Object?> toJson() => {
    'slot_id': slotId,
    'mode': mode.wireValue,
  };
}

class Appointment {
  const Appointment({
    required this.id,
    required this.slotId,
    required this.patientProfileId,
    required this.doctorMembershipId,
    required this.organizationId,
    required this.mode,
    required this.status,
    required this.startsAt,
    required this.endsAt,
    required this.feeSen,
    required this.currency,
    required this.paymentState,
    required this.cancellationReasonCode,
    required this.replacedByAppointmentId,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 slotId;
  final UuidV7 patientProfileId;
  final UuidV7 doctorMembershipId;
  final UuidV7 organizationId;
  final AppointmentMode mode;
  final AppointmentStatus status;
  final Timestamp startsAt;
  final Timestamp endsAt;
  final int feeSen;
  final String currency;
  final AppointmentPaymentState? paymentState;
  final AppointmentReasonCode? cancellationReasonCode;
  final UuidV7? replacedByAppointmentId;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory Appointment.fromJson(Map<String, Object?> json) => Appointment(
    id: json['id'] as String,
    slotId: json['slot_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    doctorMembershipId: json['doctor_membership_id'] as String,
    organizationId: json['organization_id'] as String,
    mode: appointmentModeFromWire(json['mode'] as String),
    status: appointmentStatusFromWire(json['status'] as String),
    startsAt: json['starts_at'] as String,
    endsAt: json['ends_at'] as String,
    feeSen: (json['fee_sen'] as num).toInt(),
    currency: json['currency'] as String,
    paymentState: json['payment_state'] == null ? null : appointmentPaymentStateFromWire(json['payment_state'] as String),
    cancellationReasonCode: json['cancellation_reason_code'] == null ? null : appointmentReasonCodeFromWire(json['cancellation_reason_code'] as String),
    replacedByAppointmentId: json['replaced_by_appointment_id'] == null ? null : json['replaced_by_appointment_id'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'slot_id': slotId,
    'patient_profile_id': patientProfileId,
    'doctor_membership_id': doctorMembershipId,
    'organization_id': organizationId,
    'mode': mode.wireValue,
    'status': status.wireValue,
    'starts_at': startsAt,
    'ends_at': endsAt,
    'fee_sen': feeSen,
    'currency': currency,
    'payment_state': paymentState?.wireValue,
    'cancellation_reason_code': cancellationReasonCode?.wireValue,
    'replaced_by_appointment_id': replacedByAppointmentId,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class RescheduledAppointment {
  const RescheduledAppointment({
    required this.id,
    required this.slotId,
    required this.patientProfileId,
    required this.doctorMembershipId,
    required this.organizationId,
    required this.mode,
    required this.status,
    required this.startsAt,
    required this.endsAt,
    required this.feeSen,
    required this.currency,
    required this.paymentState,
    required this.cancellationReasonCode,
    required this.replacedByAppointmentId,
    this.replacesAppointmentId,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 slotId;
  final UuidV7 patientProfileId;
  final UuidV7 doctorMembershipId;
  final UuidV7 organizationId;
  final AppointmentMode mode;
  final AppointmentStatus status;
  final Timestamp startsAt;
  final Timestamp endsAt;
  final int feeSen;
  final String currency;
  final AppointmentPaymentState? paymentState;
  final AppointmentReasonCode? cancellationReasonCode;
  final UuidV7? replacedByAppointmentId;
  final String? replacesAppointmentId;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory RescheduledAppointment.fromJson(Map<String, Object?> json) => RescheduledAppointment(
    id: json['id'] as String,
    slotId: json['slot_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    doctorMembershipId: json['doctor_membership_id'] as String,
    organizationId: json['organization_id'] as String,
    mode: appointmentModeFromWire(json['mode'] as String),
    status: appointmentStatusFromWire(json['status'] as String),
    startsAt: json['starts_at'] as String,
    endsAt: json['ends_at'] as String,
    feeSen: (json['fee_sen'] as num).toInt(),
    currency: json['currency'] as String,
    paymentState: json['payment_state'] == null ? null : appointmentPaymentStateFromWire(json['payment_state'] as String),
    cancellationReasonCode: json['cancellation_reason_code'] == null ? null : appointmentReasonCodeFromWire(json['cancellation_reason_code'] as String),
    replacedByAppointmentId: json['replaced_by_appointment_id'] == null ? null : json['replaced_by_appointment_id'] as String,
    replacesAppointmentId: json['replaces_appointment_id'] == null ? null : json['replaces_appointment_id'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'slot_id': slotId,
    'patient_profile_id': patientProfileId,
    'doctor_membership_id': doctorMembershipId,
    'organization_id': organizationId,
    'mode': mode.wireValue,
    'status': status.wireValue,
    'starts_at': startsAt,
    'ends_at': endsAt,
    'fee_sen': feeSen,
    'currency': currency,
    'payment_state': paymentState?.wireValue,
    'cancellation_reason_code': cancellationReasonCode?.wireValue,
    'replaced_by_appointment_id': replacedByAppointmentId,
    'replaces_appointment_id': replacesAppointmentId,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class AppointmentListResponse {
  const AppointmentListResponse({
    required this.data,
    required this.page,
  });

  final List<Appointment> data;
  final PageInfo page;

  factory AppointmentListResponse.fromJson(Map<String, Object?> json) => AppointmentListResponse(
    data: (json['data'] as List).map((e) => Appointment.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class CancelAppointmentRequest {
  const CancelAppointmentRequest({
    required this.status,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String status;
  final AppointmentCancellationReasonCode reasonCode;
  final int expectedVersion;

  factory CancelAppointmentRequest.fromJson(Map<String, Object?> json) => CancelAppointmentRequest(
    status: json['status'] as String,
    reasonCode: appointmentCancellationReasonCodeFromWire(json['reason_code'] as String),
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode.wireValue,
    'expected_version': expectedVersion,
  };
}

class CompleteAppointmentRequest {
  const CompleteAppointmentRequest({
    required this.status,
    required this.expectedVersion,
  });

  final String status;
  final int expectedVersion;

  factory CompleteAppointmentRequest.fromJson(Map<String, Object?> json) => CompleteAppointmentRequest(
    status: json['status'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'expected_version': expectedVersion,
  };
}

class RecordAppointmentNoShowRequest {
  const RecordAppointmentNoShowRequest({
    required this.status,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String status;
  final AppointmentNoShowReasonCode reasonCode;
  final int expectedVersion;

  factory RecordAppointmentNoShowRequest.fromJson(Map<String, Object?> json) => RecordAppointmentNoShowRequest(
    status: json['status'] as String,
    reasonCode: appointmentNoShowReasonCodeFromWire(json['reason_code'] as String),
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode.wireValue,
    'expected_version': expectedVersion,
  };
}

class RescheduleAppointmentRequest {
  const RescheduleAppointmentRequest({
    required this.slotId,
    this.mode,
    required this.expectedVersion,
  });

  final String slotId;
  final AppointmentMode? mode;
  final int expectedVersion;

  factory RescheduleAppointmentRequest.fromJson(Map<String, Object?> json) => RescheduleAppointmentRequest(
    slotId: json['slot_id'] as String,
    mode: json['mode'] == null ? null : appointmentModeFromWire(json['mode'] as String),
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'slot_id': slotId,
    'mode': mode?.wireValue,
    'expected_version': expectedVersion,
  };
}

enum DeviceType {
  vitalsMonitor,
  ecg,
  thermometer,
  pulseOximeter,
  simulator,
  phone,
  unknown,
}

extension DeviceTypeWire on DeviceType {
  String get wireValue => switch (this) {
    DeviceType.vitalsMonitor => 'vitals_monitor',
    DeviceType.ecg => 'ecg',
    DeviceType.thermometer => 'thermometer',
    DeviceType.pulseOximeter => 'pulse_oximeter',
    DeviceType.simulator => 'simulator',
    DeviceType.phone => 'phone',
    DeviceType.unknown => throw StateError('Cannot serialize unknown DeviceType'),
  };
}

DeviceType deviceTypeFromWire(String value) => switch (value) {
  'vitals_monitor' => DeviceType.vitalsMonitor,
  'ecg' => DeviceType.ecg,
  'thermometer' => DeviceType.thermometer,
  'pulse_oximeter' => DeviceType.pulseOximeter,
  'simulator' => DeviceType.simulator,
  'phone' => DeviceType.phone,
  _ => DeviceType.unknown,
};

enum DeviceState {
  provisioned,
  active,
  suspended,
  retired,
  unknown,
}

extension DeviceStateWire on DeviceState {
  String get wireValue => switch (this) {
    DeviceState.provisioned => 'provisioned',
    DeviceState.active => 'active',
    DeviceState.suspended => 'suspended',
    DeviceState.retired => 'retired',
    DeviceState.unknown => throw StateError('Cannot serialize unknown DeviceState'),
  };
}

DeviceState deviceStateFromWire(String value) => switch (value) {
  'provisioned' => DeviceState.provisioned,
  'active' => DeviceState.active,
  'suspended' => DeviceState.suspended,
  'retired' => DeviceState.retired,
  _ => DeviceState.unknown,
};

enum DeviceCredentialType {
  mqttPassword,
  clientCertificate,
  unknown,
}

extension DeviceCredentialTypeWire on DeviceCredentialType {
  String get wireValue => switch (this) {
    DeviceCredentialType.mqttPassword => 'mqtt_password',
    DeviceCredentialType.clientCertificate => 'client_certificate',
    DeviceCredentialType.unknown => throw StateError('Cannot serialize unknown DeviceCredentialType'),
  };
}

DeviceCredentialType deviceCredentialTypeFromWire(String value) => switch (value) {
  'mqtt_password' => DeviceCredentialType.mqttPassword,
  'client_certificate' => DeviceCredentialType.clientCertificate,
  _ => DeviceCredentialType.unknown,
};

enum DeviceReleaseReasonCode {
  administrativeRequest,
  deviceReplaced,
  deviceFault,
  patientDischarged,
  assignmentCorrection,
  securityIncident,
  offboarding,
  unknown,
}

extension DeviceReleaseReasonCodeWire on DeviceReleaseReasonCode {
  String get wireValue => switch (this) {
    DeviceReleaseReasonCode.administrativeRequest => 'administrative_request',
    DeviceReleaseReasonCode.deviceReplaced => 'device_replaced',
    DeviceReleaseReasonCode.deviceFault => 'device_fault',
    DeviceReleaseReasonCode.patientDischarged => 'patient_discharged',
    DeviceReleaseReasonCode.assignmentCorrection => 'assignment_correction',
    DeviceReleaseReasonCode.securityIncident => 'security_incident',
    DeviceReleaseReasonCode.offboarding => 'offboarding',
    DeviceReleaseReasonCode.unknown => throw StateError('Cannot serialize unknown DeviceReleaseReasonCode'),
  };
}

DeviceReleaseReasonCode deviceReleaseReasonCodeFromWire(String value) => switch (value) {
  'administrative_request' => DeviceReleaseReasonCode.administrativeRequest,
  'device_replaced' => DeviceReleaseReasonCode.deviceReplaced,
  'device_fault' => DeviceReleaseReasonCode.deviceFault,
  'patient_discharged' => DeviceReleaseReasonCode.patientDischarged,
  'assignment_correction' => DeviceReleaseReasonCode.assignmentCorrection,
  'security_incident' => DeviceReleaseReasonCode.securityIncident,
  'offboarding' => DeviceReleaseReasonCode.offboarding,
  _ => DeviceReleaseReasonCode.unknown,
};

class DeviceAssignment {
  const DeviceAssignment({
    required this.id,
    required this.patientProfileId,
    required this.assignedByProfileId,
    required this.assignedAt,
  });

  final UuidV7 id;
  final UuidV7 patientProfileId;
  final UuidV7 assignedByProfileId;
  final Timestamp assignedAt;

  factory DeviceAssignment.fromJson(Map<String, Object?> json) => DeviceAssignment(
    id: json['id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    assignedByProfileId: json['assigned_by_profile_id'] as String,
    assignedAt: json['assigned_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'patient_profile_id': patientProfileId,
    'assigned_by_profile_id': assignedByProfileId,
    'assigned_at': assignedAt,
  };
}

class Device {
  const Device({
    required this.id,
    required this.organizationId,
    required this.deviceType,
    required this.serialNumber,
    required this.hardwareRevision,
    required this.firmwareVersion,
    required this.state,
    required this.provisionedAt,
    required this.lastSeenAt,
    required this.activeAssignment,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 organizationId;
  final DeviceType deviceType;
  final String serialNumber;
  final String? hardwareRevision;
  final String? firmwareVersion;
  final DeviceState state;
  final Timestamp provisionedAt;
  final Timestamp? lastSeenAt;
  final DeviceAssignment? activeAssignment;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory Device.fromJson(Map<String, Object?> json) => Device(
    id: json['id'] as String,
    organizationId: json['organization_id'] as String,
    deviceType: deviceTypeFromWire(json['device_type'] as String),
    serialNumber: json['serial_number'] as String,
    hardwareRevision: json['hardware_revision'] == null ? null : json['hardware_revision'] as String,
    firmwareVersion: json['firmware_version'] == null ? null : json['firmware_version'] as String,
    state: deviceStateFromWire(json['state'] as String),
    provisionedAt: json['provisioned_at'] as String,
    lastSeenAt: json['last_seen_at'] == null ? null : json['last_seen_at'] as String,
    activeAssignment: json['active_assignment'] == null ? null : DeviceAssignment.fromJson(json['active_assignment'] as Map<String, Object?>),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'organization_id': organizationId,
    'device_type': deviceType.wireValue,
    'serial_number': serialNumber,
    'hardware_revision': hardwareRevision,
    'firmware_version': firmwareVersion,
    'state': state.wireValue,
    'provisioned_at': provisionedAt,
    'last_seen_at': lastSeenAt,
    'active_assignment': activeAssignment?.toJson(),
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class DeviceListResponse {
  const DeviceListResponse({
    required this.data,
    required this.page,
  });

  final List<Device> data;
  final PageInfo page;

  factory DeviceListResponse.fromJson(Map<String, Object?> json) => DeviceListResponse(
    data: (json['data'] as List).map((e) => Device.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class RegisterDeviceRequest {
  const RegisterDeviceRequest({
    required this.deviceType,
    required this.serialNumber,
    this.hardwareRevision,
    this.firmwareVersion,
    required this.credentialType,
    required this.provisioningSecret,
  });

  final DeviceType deviceType;
  final String serialNumber;
  final String? hardwareRevision;
  final String? firmwareVersion;
  final DeviceCredentialType credentialType;
  final String provisioningSecret;

  factory RegisterDeviceRequest.fromJson(Map<String, Object?> json) => RegisterDeviceRequest(
    deviceType: deviceTypeFromWire(json['device_type'] as String),
    serialNumber: json['serial_number'] as String,
    hardwareRevision: json['hardware_revision'] == null ? null : json['hardware_revision'] as String,
    firmwareVersion: json['firmware_version'] == null ? null : json['firmware_version'] as String,
    credentialType: deviceCredentialTypeFromWire(json['credential_type'] as String),
    provisioningSecret: json['provisioning_secret'] as String,
  );

  Map<String, Object?> toJson() => {
    'device_type': deviceType.wireValue,
    'serial_number': serialNumber,
    'hardware_revision': hardwareRevision,
    'firmware_version': firmwareVersion,
    'credential_type': credentialType.wireValue,
    'provisioning_secret': provisioningSecret,
  };
}

class AssignDeviceRequest {
  const AssignDeviceRequest({
    required this.patientProfileId,
    required this.expectedVersion,
  });

  final String patientProfileId;
  final int expectedVersion;

  factory AssignDeviceRequest.fromJson(Map<String, Object?> json) => AssignDeviceRequest(
    patientProfileId: json['patient_profile_id'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'patient_profile_id': patientProfileId,
    'expected_version': expectedVersion,
  };
}

class ReleaseDeviceRequest {
  const ReleaseDeviceRequest({
    required this.expectedVersion,
    required this.reasonCode,
  });

  final int expectedVersion;
  final DeviceReleaseReasonCode reasonCode;

  factory ReleaseDeviceRequest.fromJson(Map<String, Object?> json) => ReleaseDeviceRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
    reasonCode: deviceReleaseReasonCodeFromWire(json['reason_code'] as String),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
    'reason_code': reasonCode.wireValue,
  };
}

class OwnAssignDeviceRequest {
  const OwnAssignDeviceRequest({
    this.expectedVersion,
  });

  final int? expectedVersion;

  factory OwnAssignDeviceRequest.fromJson(Map<String, Object?> json) => OwnAssignDeviceRequest(
    expectedVersion: json['expected_version'] == null ? null : (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
  };
}

class OwnReleaseDeviceRequest {
  const OwnReleaseDeviceRequest({
    required this.expectedVersion,
    required this.reasonCode,
  });

  final int expectedVersion;
  final DeviceReleaseReasonCode reasonCode;

  factory OwnReleaseDeviceRequest.fromJson(Map<String, Object?> json) => OwnReleaseDeviceRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
    reasonCode: deviceReleaseReasonCodeFromWire(json['reason_code'] as String),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
    'reason_code': reasonCode.wireValue,
  };
}

enum VitalMetric {
  heartRate,
  oxygenSaturation,
  bodyTemperature,
  systolicBp,
  diastolicBp,
  respiratoryRate,
  ecgVoltage,
  bloodPressure,
  bloodGlucose,
  bodyWeight,
  unknown,
}

extension VitalMetricWire on VitalMetric {
  String get wireValue => switch (this) {
    VitalMetric.heartRate => 'heart_rate',
    VitalMetric.oxygenSaturation => 'oxygen_saturation',
    VitalMetric.bodyTemperature => 'body_temperature',
    VitalMetric.systolicBp => 'systolic_bp',
    VitalMetric.diastolicBp => 'diastolic_bp',
    VitalMetric.respiratoryRate => 'respiratory_rate',
    VitalMetric.ecgVoltage => 'ecg_voltage',
    VitalMetric.bloodPressure => 'blood_pressure',
    VitalMetric.bloodGlucose => 'blood_glucose',
    VitalMetric.bodyWeight => 'body_weight',
    VitalMetric.unknown => throw StateError('Cannot serialize unknown VitalMetric'),
  };
}

VitalMetric vitalMetricFromWire(String value) => switch (value) {
  'heart_rate' => VitalMetric.heartRate,
  'oxygen_saturation' => VitalMetric.oxygenSaturation,
  'body_temperature' => VitalMetric.bodyTemperature,
  'systolic_bp' => VitalMetric.systolicBp,
  'diastolic_bp' => VitalMetric.diastolicBp,
  'respiratory_rate' => VitalMetric.respiratoryRate,
  'ecg_voltage' => VitalMetric.ecgVoltage,
  'blood_pressure' => VitalMetric.bloodPressure,
  'blood_glucose' => VitalMetric.bloodGlucose,
  'body_weight' => VitalMetric.bodyWeight,
  _ => VitalMetric.unknown,
};

enum VitalReadingQuality {
  valid,
  suspect,
  invalid,
  unknown,
}

extension VitalReadingQualityWire on VitalReadingQuality {
  String get wireValue => switch (this) {
    VitalReadingQuality.valid => 'valid',
    VitalReadingQuality.suspect => 'suspect',
    VitalReadingQuality.invalid => 'invalid',
    VitalReadingQuality.unknown => 'unknown',
  };
}

VitalReadingQuality vitalReadingQualityFromWire(String value) => switch (value) {
  'valid' => VitalReadingQuality.valid,
  'suspect' => VitalReadingQuality.suspect,
  'invalid' => VitalReadingQuality.invalid,
  'unknown' => VitalReadingQuality.unknown,
  _ => VitalReadingQuality.unknown,
};

enum HealthAlertSeverity {
  info,
  warning,
  critical,
  unknown,
}

extension HealthAlertSeverityWire on HealthAlertSeverity {
  String get wireValue => switch (this) {
    HealthAlertSeverity.info => 'info',
    HealthAlertSeverity.warning => 'warning',
    HealthAlertSeverity.critical => 'critical',
    HealthAlertSeverity.unknown => throw StateError('Cannot serialize unknown HealthAlertSeverity'),
  };
}

HealthAlertSeverity healthAlertSeverityFromWire(String value) => switch (value) {
  'info' => HealthAlertSeverity.info,
  'warning' => HealthAlertSeverity.warning,
  'critical' => HealthAlertSeverity.critical,
  _ => HealthAlertSeverity.unknown,
};

enum HealthAlertState {
  open,
  acknowledged,
  escalated,
  resolved,
  dismissed,
  unknown,
}

extension HealthAlertStateWire on HealthAlertState {
  String get wireValue => switch (this) {
    HealthAlertState.open => 'open',
    HealthAlertState.acknowledged => 'acknowledged',
    HealthAlertState.escalated => 'escalated',
    HealthAlertState.resolved => 'resolved',
    HealthAlertState.dismissed => 'dismissed',
    HealthAlertState.unknown => throw StateError('Cannot serialize unknown HealthAlertState'),
  };
}

HealthAlertState healthAlertStateFromWire(String value) => switch (value) {
  'open' => HealthAlertState.open,
  'acknowledged' => HealthAlertState.acknowledged,
  'escalated' => HealthAlertState.escalated,
  'resolved' => HealthAlertState.resolved,
  'dismissed' => HealthAlertState.dismissed,
  _ => HealthAlertState.unknown,
};

class VitalReadingSample {
  const VitalReadingSample({
    required this.bootId,
    required this.sequenceNumber,
    required this.metric,
    required this.value,
    required this.unit,
    required this.recordedAt,
    required this.quality,
  });

  final int bootId;
  final int sequenceNumber;
  final VitalMetric metric;
  final double value;
  final String unit;
  final String recordedAt;
  final VitalReadingQuality quality;

  factory VitalReadingSample.fromJson(Map<String, Object?> json) => VitalReadingSample(
    bootId: (json['boot_id'] as num).toInt(),
    sequenceNumber: (json['sequence_number'] as num).toInt(),
    metric: vitalMetricFromWire(json['metric'] as String),
    value: (json['value'] as num).toDouble(),
    unit: json['unit'] as String,
    recordedAt: json['recorded_at'] as String,
    quality: vitalReadingQualityFromWire(json['quality'] as String),
  );

  Map<String, Object?> toJson() => {
    'boot_id': bootId,
    'sequence_number': sequenceNumber,
    'metric': metric.wireValue,
    'value': value,
    'unit': unit,
    'recorded_at': recordedAt,
    'quality': quality.wireValue,
  };
}

class IngestVitalReadingsRequest {
  const IngestVitalReadingsRequest({
    required this.readings,
  });

  final List<VitalReadingSample> readings;

  factory IngestVitalReadingsRequest.fromJson(Map<String, Object?> json) => IngestVitalReadingsRequest(
    readings: (json['readings'] as List).map((e) => VitalReadingSample.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'readings': readings.map((e) => e.toJson()).toList(),
  };
}

class AcceptedVitalReading {
  const AcceptedVitalReading({
    required this.id,
    required this.metric,
    required this.value,
    required this.unit,
    required this.recordedAt,
    required this.quality,
  });

  final UuidV7 id;
  final VitalMetric metric;
  final double value;
  final String unit;
  final Timestamp recordedAt;
  final VitalReadingQuality quality;

  factory AcceptedVitalReading.fromJson(Map<String, Object?> json) => AcceptedVitalReading(
    id: json['id'] as String,
    metric: vitalMetricFromWire(json['metric'] as String),
    value: (json['value'] as num).toDouble(),
    unit: json['unit'] as String,
    recordedAt: json['recorded_at'] as String,
    quality: vitalReadingQualityFromWire(json['quality'] as String),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'metric': metric.wireValue,
    'value': value,
    'unit': unit,
    'recorded_at': recordedAt,
    'quality': quality.wireValue,
  };
}

class VitalReadingIngestOutcome {
  const VitalReadingIngestOutcome({
    required this.deviceId,
    required this.patientProfileId,
    required this.accepted,
    required this.deduplicated,
    required this.rejected,
    required this.alertsRaised,
    required this.acceptedReadings,
  });

  final UuidV7 deviceId;
  final UuidV7 patientProfileId;
  final int accepted;
  final int deduplicated;
  final int rejected;
  final int alertsRaised;
  final List<AcceptedVitalReading> acceptedReadings;

  factory VitalReadingIngestOutcome.fromJson(Map<String, Object?> json) => VitalReadingIngestOutcome(
    deviceId: json['device_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    accepted: (json['accepted'] as num).toInt(),
    deduplicated: (json['deduplicated'] as num).toInt(),
    rejected: (json['rejected'] as num).toInt(),
    alertsRaised: (json['alerts_raised'] as num).toInt(),
    acceptedReadings: (json['accepted_readings'] as List).map((e) => AcceptedVitalReading.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'device_id': deviceId,
    'patient_profile_id': patientProfileId,
    'accepted': accepted,
    'deduplicated': deduplicated,
    'rejected': rejected,
    'alerts_raised': alertsRaised,
    'accepted_readings': acceptedReadings.map((e) => e.toJson()).toList(),
  };
}

class VitalReading {
  const VitalReading({
    required this.id,
    required this.deviceId,
    required this.patientProfileId,
    required this.metric,
    required this.value,
    required this.unit,
    required this.recordedAt,
    required this.ingestedAt,
    required this.quality,
  });

  final UuidV7 id;
  final UuidV7 deviceId;
  final UuidV7 patientProfileId;
  final VitalMetric metric;
  final double value;
  final String unit;
  final Timestamp recordedAt;
  final String ingestedAt;
  final VitalReadingQuality quality;

  factory VitalReading.fromJson(Map<String, Object?> json) => VitalReading(
    id: json['id'] as String,
    deviceId: json['device_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    metric: vitalMetricFromWire(json['metric'] as String),
    value: (json['value'] as num).toDouble(),
    unit: json['unit'] as String,
    recordedAt: json['recorded_at'] as String,
    ingestedAt: json['ingested_at'] as String,
    quality: vitalReadingQualityFromWire(json['quality'] as String),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'device_id': deviceId,
    'patient_profile_id': patientProfileId,
    'metric': metric.wireValue,
    'value': value,
    'unit': unit,
    'recorded_at': recordedAt,
    'ingested_at': ingestedAt,
    'quality': quality.wireValue,
  };
}

class VitalReadingListResponse {
  const VitalReadingListResponse({
    required this.data,
    required this.page,
  });

  final List<VitalReading> data;
  final PageInfo page;

  factory VitalReadingListResponse.fromJson(Map<String, Object?> json) => VitalReadingListResponse(
    data: (json['data'] as List).map((e) => VitalReading.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class HealthAlert {
  const HealthAlert({
    required this.id,
    required this.organizationId,
    required this.patientProfileId,
    required this.deviceId,
    required this.metric,
    required this.observedValue,
    required this.thresholdId,
    required this.severity,
    required this.state,
    required this.observedAt,
    required this.acknowledgedByProfileId,
    required this.acknowledgedAt,
    required this.resolvedAt,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 organizationId;
  final UuidV7 patientProfileId;
  final UuidV7 deviceId;
  final VitalMetric metric;
  final double observedValue;
  final String thresholdId;
  final HealthAlertSeverity severity;
  final HealthAlertState state;
  final String observedAt;
  final UuidV7? acknowledgedByProfileId;
  final Timestamp? acknowledgedAt;
  final Timestamp? resolvedAt;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory HealthAlert.fromJson(Map<String, Object?> json) => HealthAlert(
    id: json['id'] as String,
    organizationId: json['organization_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    deviceId: json['device_id'] as String,
    metric: vitalMetricFromWire(json['metric'] as String),
    observedValue: (json['observed_value'] as num).toDouble(),
    thresholdId: json['threshold_id'] as String,
    severity: healthAlertSeverityFromWire(json['severity'] as String),
    state: healthAlertStateFromWire(json['state'] as String),
    observedAt: json['observed_at'] as String,
    acknowledgedByProfileId: json['acknowledged_by_profile_id'] == null ? null : json['acknowledged_by_profile_id'] as String,
    acknowledgedAt: json['acknowledged_at'] == null ? null : json['acknowledged_at'] as String,
    resolvedAt: json['resolved_at'] == null ? null : json['resolved_at'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'organization_id': organizationId,
    'patient_profile_id': patientProfileId,
    'device_id': deviceId,
    'metric': metric.wireValue,
    'observed_value': observedValue,
    'threshold_id': thresholdId,
    'severity': severity.wireValue,
    'state': state.wireValue,
    'observed_at': observedAt,
    'acknowledged_by_profile_id': acknowledgedByProfileId,
    'acknowledged_at': acknowledgedAt,
    'resolved_at': resolvedAt,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class HealthAlertListResponse {
  const HealthAlertListResponse({
    required this.data,
    required this.page,
  });

  final List<HealthAlert> data;
  final PageInfo page;

  factory HealthAlertListResponse.fromJson(Map<String, Object?> json) => HealthAlertListResponse(
    data: (json['data'] as List).map((e) => HealthAlert.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class AcknowledgeHealthAlertRequest {
  const AcknowledgeHealthAlertRequest({
    required this.expectedVersion,
  });

  final int expectedVersion;

  factory AcknowledgeHealthAlertRequest.fromJson(Map<String, Object?> json) => AcknowledgeHealthAlertRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
  };
}

enum ProblemCode {
  authTokenInvalid,
  appSessionInvalid,
  membershipInactive,
  permissionDenied,
  objectAccessDenied,
  consentRequired,
  stepUpRequired,
  breakGlassRequired,
  resourceNotFound,
  membershipAlreadyExists,
  membershipVersionConflict,
  membershipTransitionInvalid,
  membershipSelfModificationDenied,
  lastAdminRequired,
  roleSwitchConflict,
  verificationDocumentAwaitingReview,
  verificationDocumentAlreadyFinalized,
  verificationDocumentVersionConflict,
  verificationDocumentTransitionInvalid,
  verificationSelfReviewDenied,
  objectChecksumMismatch,
  objectNotDownloadable,
  availabilityVersionConflict,
  availabilityRulesMissing,
  appointmentSlotUnavailable,
  appointmentPatientUnavailable,
  appointmentVersionConflict,
  appointmentTransitionInvalid,
  deviceSerialNumberConflict,
  deviceNotAssignable,
  deviceAlreadyAssigned,
  deviceNotAssigned,
  deviceVersionConflict,
  deviceNotIngestible,
  healthAlertVersionConflict,
  healthAlertNotOpen,
  consentAlreadyActive,
  consentVersionConflict,
  consentNotActive,
  careAssignmentAlreadyActive,
  careAssignmentVersionConflict,
  careAssignmentNotActive,
  reviewAppointmentNotCompleted,
  doctorReviewVersionConflict,
  careAssignmentRequired,
  idempotencyKeyReused,
  unsupportedMediaType,
  validationFailed,
  rateLimited,
  dependencyUnavailable,
  internalError,
  unknown,
}

extension ProblemCodeWire on ProblemCode {
  String get wireValue => switch (this) {
    ProblemCode.authTokenInvalid => 'AUTH_TOKEN_INVALID',
    ProblemCode.appSessionInvalid => 'APP_SESSION_INVALID',
    ProblemCode.membershipInactive => 'MEMBERSHIP_INACTIVE',
    ProblemCode.permissionDenied => 'PERMISSION_DENIED',
    ProblemCode.objectAccessDenied => 'OBJECT_ACCESS_DENIED',
    ProblemCode.consentRequired => 'CONSENT_REQUIRED',
    ProblemCode.stepUpRequired => 'STEP_UP_REQUIRED',
    ProblemCode.breakGlassRequired => 'BREAK_GLASS_REQUIRED',
    ProblemCode.resourceNotFound => 'RESOURCE_NOT_FOUND',
    ProblemCode.membershipAlreadyExists => 'MEMBERSHIP_ALREADY_EXISTS',
    ProblemCode.membershipVersionConflict => 'MEMBERSHIP_VERSION_CONFLICT',
    ProblemCode.membershipTransitionInvalid => 'MEMBERSHIP_TRANSITION_INVALID',
    ProblemCode.membershipSelfModificationDenied => 'MEMBERSHIP_SELF_MODIFICATION_DENIED',
    ProblemCode.lastAdminRequired => 'LAST_ADMIN_REQUIRED',
    ProblemCode.roleSwitchConflict => 'ROLE_SWITCH_CONFLICT',
    ProblemCode.verificationDocumentAwaitingReview => 'VERIFICATION_DOCUMENT_AWAITING_REVIEW',
    ProblemCode.verificationDocumentAlreadyFinalized => 'VERIFICATION_DOCUMENT_ALREADY_FINALIZED',
    ProblemCode.verificationDocumentVersionConflict => 'VERIFICATION_DOCUMENT_VERSION_CONFLICT',
    ProblemCode.verificationDocumentTransitionInvalid => 'VERIFICATION_DOCUMENT_TRANSITION_INVALID',
    ProblemCode.verificationSelfReviewDenied => 'VERIFICATION_SELF_REVIEW_DENIED',
    ProblemCode.objectChecksumMismatch => 'OBJECT_CHECKSUM_MISMATCH',
    ProblemCode.objectNotDownloadable => 'OBJECT_NOT_DOWNLOADABLE',
    ProblemCode.availabilityVersionConflict => 'AVAILABILITY_VERSION_CONFLICT',
    ProblemCode.availabilityRulesMissing => 'AVAILABILITY_RULES_MISSING',
    ProblemCode.appointmentSlotUnavailable => 'APPOINTMENT_SLOT_UNAVAILABLE',
    ProblemCode.appointmentPatientUnavailable => 'APPOINTMENT_PATIENT_UNAVAILABLE',
    ProblemCode.appointmentVersionConflict => 'APPOINTMENT_VERSION_CONFLICT',
    ProblemCode.appointmentTransitionInvalid => 'APPOINTMENT_TRANSITION_INVALID',
    ProblemCode.deviceSerialNumberConflict => 'DEVICE_SERIAL_NUMBER_CONFLICT',
    ProblemCode.deviceNotAssignable => 'DEVICE_NOT_ASSIGNABLE',
    ProblemCode.deviceAlreadyAssigned => 'DEVICE_ALREADY_ASSIGNED',
    ProblemCode.deviceNotAssigned => 'DEVICE_NOT_ASSIGNED',
    ProblemCode.deviceVersionConflict => 'DEVICE_VERSION_CONFLICT',
    ProblemCode.deviceNotIngestible => 'DEVICE_NOT_INGESTIBLE',
    ProblemCode.healthAlertVersionConflict => 'HEALTH_ALERT_VERSION_CONFLICT',
    ProblemCode.healthAlertNotOpen => 'HEALTH_ALERT_NOT_OPEN',
    ProblemCode.consentAlreadyActive => 'CONSENT_ALREADY_ACTIVE',
    ProblemCode.consentVersionConflict => 'CONSENT_VERSION_CONFLICT',
    ProblemCode.consentNotActive => 'CONSENT_NOT_ACTIVE',
    ProblemCode.careAssignmentAlreadyActive => 'CARE_ASSIGNMENT_ALREADY_ACTIVE',
    ProblemCode.careAssignmentVersionConflict => 'CARE_ASSIGNMENT_VERSION_CONFLICT',
    ProblemCode.careAssignmentNotActive => 'CARE_ASSIGNMENT_NOT_ACTIVE',
    ProblemCode.reviewAppointmentNotCompleted => 'REVIEW_APPOINTMENT_NOT_COMPLETED',
    ProblemCode.doctorReviewVersionConflict => 'DOCTOR_REVIEW_VERSION_CONFLICT',
    ProblemCode.careAssignmentRequired => 'CARE_ASSIGNMENT_REQUIRED',
    ProblemCode.idempotencyKeyReused => 'IDEMPOTENCY_KEY_REUSED',
    ProblemCode.unsupportedMediaType => 'UNSUPPORTED_MEDIA_TYPE',
    ProblemCode.validationFailed => 'VALIDATION_FAILED',
    ProblemCode.rateLimited => 'RATE_LIMITED',
    ProblemCode.dependencyUnavailable => 'DEPENDENCY_UNAVAILABLE',
    ProblemCode.internalError => 'INTERNAL_ERROR',
    ProblemCode.unknown => throw StateError('Cannot serialize unknown ProblemCode'),
  };
}

ProblemCode problemCodeFromWire(String value) => switch (value) {
  'AUTH_TOKEN_INVALID' => ProblemCode.authTokenInvalid,
  'APP_SESSION_INVALID' => ProblemCode.appSessionInvalid,
  'MEMBERSHIP_INACTIVE' => ProblemCode.membershipInactive,
  'PERMISSION_DENIED' => ProblemCode.permissionDenied,
  'OBJECT_ACCESS_DENIED' => ProblemCode.objectAccessDenied,
  'CONSENT_REQUIRED' => ProblemCode.consentRequired,
  'STEP_UP_REQUIRED' => ProblemCode.stepUpRequired,
  'BREAK_GLASS_REQUIRED' => ProblemCode.breakGlassRequired,
  'RESOURCE_NOT_FOUND' => ProblemCode.resourceNotFound,
  'MEMBERSHIP_ALREADY_EXISTS' => ProblemCode.membershipAlreadyExists,
  'MEMBERSHIP_VERSION_CONFLICT' => ProblemCode.membershipVersionConflict,
  'MEMBERSHIP_TRANSITION_INVALID' => ProblemCode.membershipTransitionInvalid,
  'MEMBERSHIP_SELF_MODIFICATION_DENIED' => ProblemCode.membershipSelfModificationDenied,
  'LAST_ADMIN_REQUIRED' => ProblemCode.lastAdminRequired,
  'ROLE_SWITCH_CONFLICT' => ProblemCode.roleSwitchConflict,
  'VERIFICATION_DOCUMENT_AWAITING_REVIEW' => ProblemCode.verificationDocumentAwaitingReview,
  'VERIFICATION_DOCUMENT_ALREADY_FINALIZED' => ProblemCode.verificationDocumentAlreadyFinalized,
  'VERIFICATION_DOCUMENT_VERSION_CONFLICT' => ProblemCode.verificationDocumentVersionConflict,
  'VERIFICATION_DOCUMENT_TRANSITION_INVALID' => ProblemCode.verificationDocumentTransitionInvalid,
  'VERIFICATION_SELF_REVIEW_DENIED' => ProblemCode.verificationSelfReviewDenied,
  'OBJECT_CHECKSUM_MISMATCH' => ProblemCode.objectChecksumMismatch,
  'OBJECT_NOT_DOWNLOADABLE' => ProblemCode.objectNotDownloadable,
  'AVAILABILITY_VERSION_CONFLICT' => ProblemCode.availabilityVersionConflict,
  'AVAILABILITY_RULES_MISSING' => ProblemCode.availabilityRulesMissing,
  'APPOINTMENT_SLOT_UNAVAILABLE' => ProblemCode.appointmentSlotUnavailable,
  'APPOINTMENT_PATIENT_UNAVAILABLE' => ProblemCode.appointmentPatientUnavailable,
  'APPOINTMENT_VERSION_CONFLICT' => ProblemCode.appointmentVersionConflict,
  'APPOINTMENT_TRANSITION_INVALID' => ProblemCode.appointmentTransitionInvalid,
  'DEVICE_SERIAL_NUMBER_CONFLICT' => ProblemCode.deviceSerialNumberConflict,
  'DEVICE_NOT_ASSIGNABLE' => ProblemCode.deviceNotAssignable,
  'DEVICE_ALREADY_ASSIGNED' => ProblemCode.deviceAlreadyAssigned,
  'DEVICE_NOT_ASSIGNED' => ProblemCode.deviceNotAssigned,
  'DEVICE_VERSION_CONFLICT' => ProblemCode.deviceVersionConflict,
  'DEVICE_NOT_INGESTIBLE' => ProblemCode.deviceNotIngestible,
  'HEALTH_ALERT_VERSION_CONFLICT' => ProblemCode.healthAlertVersionConflict,
  'HEALTH_ALERT_NOT_OPEN' => ProblemCode.healthAlertNotOpen,
  'CONSENT_ALREADY_ACTIVE' => ProblemCode.consentAlreadyActive,
  'CONSENT_VERSION_CONFLICT' => ProblemCode.consentVersionConflict,
  'CONSENT_NOT_ACTIVE' => ProblemCode.consentNotActive,
  'CARE_ASSIGNMENT_ALREADY_ACTIVE' => ProblemCode.careAssignmentAlreadyActive,
  'CARE_ASSIGNMENT_VERSION_CONFLICT' => ProblemCode.careAssignmentVersionConflict,
  'CARE_ASSIGNMENT_NOT_ACTIVE' => ProblemCode.careAssignmentNotActive,
  'REVIEW_APPOINTMENT_NOT_COMPLETED' => ProblemCode.reviewAppointmentNotCompleted,
  'DOCTOR_REVIEW_VERSION_CONFLICT' => ProblemCode.doctorReviewVersionConflict,
  'CARE_ASSIGNMENT_REQUIRED' => ProblemCode.careAssignmentRequired,
  'IDEMPOTENCY_KEY_REUSED' => ProblemCode.idempotencyKeyReused,
  'UNSUPPORTED_MEDIA_TYPE' => ProblemCode.unsupportedMediaType,
  'VALIDATION_FAILED' => ProblemCode.validationFailed,
  'RATE_LIMITED' => ProblemCode.rateLimited,
  'DEPENDENCY_UNAVAILABLE' => ProblemCode.dependencyUnavailable,
  'INTERNAL_ERROR' => ProblemCode.internalError,
  _ => ProblemCode.unknown,
};

class FieldViolation {
  const FieldViolation({
    required this.field,
    required this.code,
    required this.message,
  });

  final String field;
  final String code;
  final String message;

  factory FieldViolation.fromJson(Map<String, Object?> json) => FieldViolation(
    field: json['field'] as String,
    code: json['code'] as String,
    message: json['message'] as String,
  );

  Map<String, Object?> toJson() => {
    'field': field,
    'code': code,
    'message': message,
  };
}

class ProblemDetails {
  const ProblemDetails({
    required this.type,
    required this.title,
    required this.status,
    this.detail,
    this.instance,
    required this.code,
    required this.correlationId,
    this.errors,
  });

  final String type;
  final String title;
  final int status;
  final String? detail;
  final String? instance;
  final ProblemCode code;
  final UuidV7 correlationId;
  final List<FieldViolation>? errors;

  factory ProblemDetails.fromJson(Map<String, Object?> json) => ProblemDetails(
    type: json['type'] as String,
    title: json['title'] as String,
    status: (json['status'] as num).toInt(),
    detail: json['detail'] == null ? null : json['detail'] as String,
    instance: json['instance'] == null ? null : json['instance'] as String,
    code: problemCodeFromWire(json['code'] as String),
    correlationId: json['correlation_id'] as String,
    errors: json['errors'] == null ? null : (json['errors'] as List).map((e) => FieldViolation.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'type': type,
    'title': title,
    'status': status,
    'detail': detail,
    'instance': instance,
    'code': code.wireValue,
    'correlation_id': correlationId,
    'errors': errors?.map((e) => e.toJson()).toList(),
  };
}

enum ConsentScope {
  profileContact,
  clinicalRecord,
  medication,
  iotReading,
  aiArtifact,
  fullRecord,
  unknown,
}

extension ConsentScopeWire on ConsentScope {
  String get wireValue => switch (this) {
    ConsentScope.profileContact => 'profile_contact',
    ConsentScope.clinicalRecord => 'clinical_record',
    ConsentScope.medication => 'medication',
    ConsentScope.iotReading => 'iot_reading',
    ConsentScope.aiArtifact => 'ai_artifact',
    ConsentScope.fullRecord => 'full_record',
    ConsentScope.unknown => throw StateError('Cannot serialize unknown ConsentScope'),
  };
}

ConsentScope consentScopeFromWire(String value) => switch (value) {
  'profile_contact' => ConsentScope.profileContact,
  'clinical_record' => ConsentScope.clinicalRecord,
  'medication' => ConsentScope.medication,
  'iot_reading' => ConsentScope.iotReading,
  'ai_artifact' => ConsentScope.aiArtifact,
  'full_record' => ConsentScope.fullRecord,
  _ => ConsentScope.unknown,
};

enum ConsentStatus {
  active,
  revoked,
  expired,
  unknown,
}

extension ConsentStatusWire on ConsentStatus {
  String get wireValue => switch (this) {
    ConsentStatus.active => 'active',
    ConsentStatus.revoked => 'revoked',
    ConsentStatus.expired => 'expired',
    ConsentStatus.unknown => throw StateError('Cannot serialize unknown ConsentStatus'),
  };
}

ConsentStatus consentStatusFromWire(String value) => switch (value) {
  'active' => ConsentStatus.active,
  'revoked' => ConsentStatus.revoked,
  'expired' => ConsentStatus.expired,
  _ => ConsentStatus.unknown,
};

enum ConsentRevocationReason {
  grantorRequest,
  granteeRequest,
  adminAction,
  superseded,
  policyViolation,
  membershipEnded,
  unknown,
}

extension ConsentRevocationReasonWire on ConsentRevocationReason {
  String get wireValue => switch (this) {
    ConsentRevocationReason.grantorRequest => 'grantor_request',
    ConsentRevocationReason.granteeRequest => 'grantee_request',
    ConsentRevocationReason.adminAction => 'admin_action',
    ConsentRevocationReason.superseded => 'superseded',
    ConsentRevocationReason.policyViolation => 'policy_violation',
    ConsentRevocationReason.membershipEnded => 'membership_ended',
    ConsentRevocationReason.unknown => throw StateError('Cannot serialize unknown ConsentRevocationReason'),
  };
}

ConsentRevocationReason consentRevocationReasonFromWire(String value) => switch (value) {
  'grantor_request' => ConsentRevocationReason.grantorRequest,
  'grantee_request' => ConsentRevocationReason.granteeRequest,
  'admin_action' => ConsentRevocationReason.adminAction,
  'superseded' => ConsentRevocationReason.superseded,
  'policy_violation' => ConsentRevocationReason.policyViolation,
  'membership_ended' => ConsentRevocationReason.membershipEnded,
  _ => ConsentRevocationReason.unknown,
};

class ConsentGrant {
  const ConsentGrant({
    required this.id,
    required this.organizationId,
    required this.grantorProfileId,
    required this.granteeProfileId,
    required this.granteeMembershipId,
    required this.scope,
    required this.purpose,
    required this.status,
    required this.grantedAt,
    required this.expiresAt,
    required this.revokedAt,
    required this.revocationReason,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 organizationId;
  final UuidV7 grantorProfileId;
  final UuidV7? granteeProfileId;
  final UuidV7? granteeMembershipId;
  final ConsentScope scope;
  final String purpose;
  final ConsentStatus status;
  final Timestamp grantedAt;
  final Timestamp? expiresAt;
  final Timestamp? revokedAt;
  final ConsentRevocationReason? revocationReason;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory ConsentGrant.fromJson(Map<String, Object?> json) => ConsentGrant(
    id: json['id'] as String,
    organizationId: json['organization_id'] as String,
    grantorProfileId: json['grantor_profile_id'] as String,
    granteeProfileId: json['grantee_profile_id'] == null ? null : json['grantee_profile_id'] as String,
    granteeMembershipId: json['grantee_membership_id'] == null ? null : json['grantee_membership_id'] as String,
    scope: consentScopeFromWire(json['scope'] as String),
    purpose: json['purpose'] as String,
    status: consentStatusFromWire(json['status'] as String),
    grantedAt: json['granted_at'] as String,
    expiresAt: json['expires_at'] == null ? null : json['expires_at'] as String,
    revokedAt: json['revoked_at'] == null ? null : json['revoked_at'] as String,
    revocationReason: json['revocation_reason'] == null ? null : consentRevocationReasonFromWire(json['revocation_reason'] as String),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'organization_id': organizationId,
    'grantor_profile_id': grantorProfileId,
    'grantee_profile_id': granteeProfileId,
    'grantee_membership_id': granteeMembershipId,
    'scope': scope.wireValue,
    'purpose': purpose,
    'status': status.wireValue,
    'granted_at': grantedAt,
    'expires_at': expiresAt,
    'revoked_at': revokedAt,
    'revocation_reason': revocationReason?.wireValue,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class CreateConsentGrantRequest {
  const CreateConsentGrantRequest({
    this.granteeProfileId,
    this.granteeMembershipId,
    required this.scope,
    required this.purpose,
    this.expiresAt,
  });

  final UuidV7? granteeProfileId;
  final UuidV7? granteeMembershipId;
  final ConsentScope scope;
  final String purpose;
  final Timestamp? expiresAt;

  factory CreateConsentGrantRequest.fromJson(Map<String, Object?> json) => CreateConsentGrantRequest(
    granteeProfileId: json['grantee_profile_id'] == null ? null : json['grantee_profile_id'] as String,
    granteeMembershipId: json['grantee_membership_id'] == null ? null : json['grantee_membership_id'] as String,
    scope: consentScopeFromWire(json['scope'] as String),
    purpose: json['purpose'] as String,
    expiresAt: json['expires_at'] == null ? null : json['expires_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'grantee_profile_id': granteeProfileId,
    'grantee_membership_id': granteeMembershipId,
    'scope': scope.wireValue,
    'purpose': purpose,
    'expires_at': expiresAt,
  };
}

class RevokeConsentGrantRequest {
  const RevokeConsentGrantRequest({
    required this.expectedVersion,
    required this.reason,
  });

  final int expectedVersion;
  final ConsentRevocationReason reason;

  factory RevokeConsentGrantRequest.fromJson(Map<String, Object?> json) => RevokeConsentGrantRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
    reason: consentRevocationReasonFromWire(json['reason'] as String),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
    'reason': reason.wireValue,
  };
}

class ConsentGrantPage {
  const ConsentGrantPage({
    required this.data,
    required this.page,
  });

  final List<ConsentGrant> data;
  final PageInfo page;

  factory ConsentGrantPage.fromJson(Map<String, Object?> json) => ConsentGrantPage(
    data: (json['data'] as List).map((e) => ConsentGrant.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

enum CareAssignmentStatus {
  active,
  completed,
  revoked,
  expired,
  unknown,
}

extension CareAssignmentStatusWire on CareAssignmentStatus {
  String get wireValue => switch (this) {
    CareAssignmentStatus.active => 'active',
    CareAssignmentStatus.completed => 'completed',
    CareAssignmentStatus.revoked => 'revoked',
    CareAssignmentStatus.expired => 'expired',
    CareAssignmentStatus.unknown => throw StateError('Cannot serialize unknown CareAssignmentStatus'),
  };
}

CareAssignmentStatus careAssignmentStatusFromWire(String value) => switch (value) {
  'active' => CareAssignmentStatus.active,
  'completed' => CareAssignmentStatus.completed,
  'revoked' => CareAssignmentStatus.revoked,
  'expired' => CareAssignmentStatus.expired,
  _ => CareAssignmentStatus.unknown,
};

enum CareAssignmentEndReason {
  careCompleted,
  patientRequest,
  clinicianRequest,
  administrativeRequest,
  membershipEnded,
  assignmentCorrection,
  unknown,
}

extension CareAssignmentEndReasonWire on CareAssignmentEndReason {
  String get wireValue => switch (this) {
    CareAssignmentEndReason.careCompleted => 'care_completed',
    CareAssignmentEndReason.patientRequest => 'patient_request',
    CareAssignmentEndReason.clinicianRequest => 'clinician_request',
    CareAssignmentEndReason.administrativeRequest => 'administrative_request',
    CareAssignmentEndReason.membershipEnded => 'membership_ended',
    CareAssignmentEndReason.assignmentCorrection => 'assignment_correction',
    CareAssignmentEndReason.unknown => throw StateError('Cannot serialize unknown CareAssignmentEndReason'),
  };
}

CareAssignmentEndReason careAssignmentEndReasonFromWire(String value) => switch (value) {
  'care_completed' => CareAssignmentEndReason.careCompleted,
  'patient_request' => CareAssignmentEndReason.patientRequest,
  'clinician_request' => CareAssignmentEndReason.clinicianRequest,
  'administrative_request' => CareAssignmentEndReason.administrativeRequest,
  'membership_ended' => CareAssignmentEndReason.membershipEnded,
  'assignment_correction' => CareAssignmentEndReason.assignmentCorrection,
  _ => CareAssignmentEndReason.unknown,
};

class CareAssignment {
  const CareAssignment({
    required this.id,
    required this.organizationId,
    required this.clinicianMembershipId,
    required this.patientProfileId,
    required this.status,
    required this.assignedAt,
    required this.endedAt,
    required this.endedReason,
    required this.assignedByMembershipId,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final UuidV7 organizationId;
  final UuidV7 clinicianMembershipId;
  final UuidV7 patientProfileId;
  final CareAssignmentStatus status;
  final Timestamp assignedAt;
  final Timestamp? endedAt;
  final CareAssignmentEndReason? endedReason;
  final UuidV7? assignedByMembershipId;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory CareAssignment.fromJson(Map<String, Object?> json) => CareAssignment(
    id: json['id'] as String,
    organizationId: json['organization_id'] as String,
    clinicianMembershipId: json['clinician_membership_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    status: careAssignmentStatusFromWire(json['status'] as String),
    assignedAt: json['assigned_at'] as String,
    endedAt: json['ended_at'] == null ? null : json['ended_at'] as String,
    endedReason: json['ended_reason'] == null ? null : careAssignmentEndReasonFromWire(json['ended_reason'] as String),
    assignedByMembershipId: json['assigned_by_membership_id'] == null ? null : json['assigned_by_membership_id'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'organization_id': organizationId,
    'clinician_membership_id': clinicianMembershipId,
    'patient_profile_id': patientProfileId,
    'status': status.wireValue,
    'assigned_at': assignedAt,
    'ended_at': endedAt,
    'ended_reason': endedReason?.wireValue,
    'assigned_by_membership_id': assignedByMembershipId,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class CreateCareAssignmentRequest {
  const CreateCareAssignmentRequest({
    required this.clinicianMembershipId,
    required this.patientProfileId,
  });

  final UuidV7 clinicianMembershipId;
  final UuidV7 patientProfileId;

  factory CreateCareAssignmentRequest.fromJson(Map<String, Object?> json) => CreateCareAssignmentRequest(
    clinicianMembershipId: json['clinician_membership_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'clinician_membership_id': clinicianMembershipId,
    'patient_profile_id': patientProfileId,
  };
}

class EndCareAssignmentRequest {
  const EndCareAssignmentRequest({
    required this.expectedVersion,
    required this.status,
    required this.reason,
  });

  final int expectedVersion;
  final String status;
  final CareAssignmentEndReason reason;

  factory EndCareAssignmentRequest.fromJson(Map<String, Object?> json) => EndCareAssignmentRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
    status: json['status'] as String,
    reason: careAssignmentEndReasonFromWire(json['reason'] as String),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
    'status': status,
    'reason': reason.wireValue,
  };
}

class CareAssignmentPage {
  const CareAssignmentPage({
    required this.data,
    required this.page,
  });

  final List<CareAssignment> data;
  final PageInfo page;

  factory CareAssignmentPage.fromJson(Map<String, Object?> json) => CareAssignmentPage(
    data: (json['data'] as List).map((e) => CareAssignment.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

enum DoctorReviewTag {
  goodListener,
  onTime,
  clearExplanation,
  professional,
  helpful,
  unknown,
}

extension DoctorReviewTagWire on DoctorReviewTag {
  String get wireValue => switch (this) {
    DoctorReviewTag.goodListener => 'good_listener',
    DoctorReviewTag.onTime => 'on_time',
    DoctorReviewTag.clearExplanation => 'clear_explanation',
    DoctorReviewTag.professional => 'professional',
    DoctorReviewTag.helpful => 'helpful',
    DoctorReviewTag.unknown => throw StateError('Cannot serialize unknown DoctorReviewTag'),
  };
}

DoctorReviewTag doctorReviewTagFromWire(String value) => switch (value) {
  'good_listener' => DoctorReviewTag.goodListener,
  'on_time' => DoctorReviewTag.onTime,
  'clear_explanation' => DoctorReviewTag.clearExplanation,
  'professional' => DoctorReviewTag.professional,
  'helpful' => DoctorReviewTag.helpful,
  _ => DoctorReviewTag.unknown,
};

class PublicDoctorReview {
  const PublicDoctorReview({
    required this.id,
    required this.rating,
    required this.comment,
    required this.tags,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 id;
  final int rating;
  final String? comment;
  final List<DoctorReviewTag> tags;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory PublicDoctorReview.fromJson(Map<String, Object?> json) => PublicDoctorReview(
    id: json['id'] as String,
    rating: (json['rating'] as num).toInt(),
    comment: json['comment'] == null ? null : json['comment'] as String,
    tags: (json['tags'] as List).map((e) => doctorReviewTagFromWire(e as String)).toList(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'rating': rating,
    'comment': comment,
    'tags': tags.map((e) => e.wireValue).toList(),
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class DoctorDirectoryItem {
  const DoctorDirectoryItem({
    required this.membershipId,
    required this.organizationId,
    required this.displayName,
    required this.imageUrl,
    required this.practiceName,
    required this.biography,
    required this.yearsExperience,
    required this.consultationFeeSen,
    required this.currency,
    required this.acceptsNewPatients,
    required this.verified,
    required this.primarySpecialty,
    required this.specialties,
    required this.languages,
    required this.ratingAverage,
    required this.reviewCount,
    required this.nextAvailableAt,
  });

  final UuidV7 membershipId;
  final UuidV7 organizationId;
  final String displayName;
  final String? imageUrl;
  final String practiceName;
  final String? biography;
  final int yearsExperience;
  final int consultationFeeSen;
  final String currency;
  final bool acceptsNewPatients;
  final bool verified;
  final String? primarySpecialty;
  final List<String> specialties;
  final List<String> languages;
  final double ratingAverage;
  final int reviewCount;
  final Timestamp? nextAvailableAt;

  factory DoctorDirectoryItem.fromJson(Map<String, Object?> json) => DoctorDirectoryItem(
    membershipId: json['membership_id'] as String,
    organizationId: json['organization_id'] as String,
    displayName: json['display_name'] as String,
    imageUrl: json['image_url'] == null ? null : json['image_url'] as String,
    practiceName: json['practice_name'] as String,
    biography: json['biography'] == null ? null : json['biography'] as String,
    yearsExperience: (json['years_experience'] as num).toInt(),
    consultationFeeSen: (json['consultation_fee_sen'] as num).toInt(),
    currency: json['currency'] as String,
    acceptsNewPatients: json['accepts_new_patients'] as bool,
    verified: json['verified'] as bool,
    primarySpecialty: json['primary_specialty'] == null ? null : json['primary_specialty'] as String,
    specialties: List<String>.from(json['specialties'] as List),
    languages: List<String>.from(json['languages'] as List),
    ratingAverage: (json['rating_average'] as num).toDouble(),
    reviewCount: (json['review_count'] as num).toInt(),
    nextAvailableAt: json['next_available_at'] == null ? null : json['next_available_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'membership_id': membershipId,
    'organization_id': organizationId,
    'display_name': displayName,
    'image_url': imageUrl,
    'practice_name': practiceName,
    'biography': biography,
    'years_experience': yearsExperience,
    'consultation_fee_sen': consultationFeeSen,
    'currency': currency,
    'accepts_new_patients': acceptsNewPatients,
    'verified': verified,
    'primary_specialty': primarySpecialty,
    'specialties': specialties,
    'languages': languages,
    'rating_average': ratingAverage,
    'review_count': reviewCount,
    'next_available_at': nextAvailableAt,
  };
}

typedef DoctorProfile = String;

class DoctorDirectoryPage {
  const DoctorDirectoryPage({
    required this.data,
    required this.page,
  });

  final List<DoctorDirectoryItem> data;
  final PageInfo page;

  factory DoctorDirectoryPage.fromJson(Map<String, Object?> json) => DoctorDirectoryPage(
    data: (json['data'] as List).map((e) => DoctorDirectoryItem.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class DoctorReviewPage {
  const DoctorReviewPage({
    required this.data,
    required this.page,
  });

  final List<PublicDoctorReview> data;
  final PageInfo page;

  factory DoctorReviewPage.fromJson(Map<String, Object?> json) => DoctorReviewPage(
    data: (json['data'] as List).map((e) => PublicDoctorReview.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class PutDoctorReviewRequest {
  const PutDoctorReviewRequest({
    required this.expectedVersion,
    required this.rating,
    this.comment,
    this.tags,
  });

  final int expectedVersion;
  final int rating;
  final String? comment;
  final List<DoctorReviewTag>? tags;

  factory PutDoctorReviewRequest.fromJson(Map<String, Object?> json) => PutDoctorReviewRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
    rating: (json['rating'] as num).toInt(),
    comment: json['comment'] == null ? null : json['comment'] as String,
    tags: json['tags'] == null ? null : (json['tags'] as List).map((e) => doctorReviewTagFromWire(e as String)).toList(),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
    'rating': rating,
    'comment': comment,
    'tags': tags?.map((e) => e.wireValue).toList(),
  };
}

class SavedDoctorReview {
  const SavedDoctorReview({
    required this.id,
    required this.appointmentId,
    required this.doctorMembershipId,
    required this.rating,
    required this.comment,
    required this.tags,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
    required this.replayed,
  });

  final UuidV7 id;
  final UuidV7 appointmentId;
  final UuidV7 doctorMembershipId;
  final int rating;
  final String? comment;
  final List<DoctorReviewTag> tags;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;
  final bool replayed;

  factory SavedDoctorReview.fromJson(Map<String, Object?> json) => SavedDoctorReview(
    id: json['id'] as String,
    appointmentId: json['appointment_id'] as String,
    doctorMembershipId: json['doctor_membership_id'] as String,
    rating: (json['rating'] as num).toInt(),
    comment: json['comment'] == null ? null : json['comment'] as String,
    tags: (json['tags'] as List).map((e) => doctorReviewTagFromWire(e as String)).toList(),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
    replayed: json['replayed'] as bool,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'appointment_id': appointmentId,
    'doctor_membership_id': doctorMembershipId,
    'rating': rating,
    'comment': comment,
    'tags': tags.map((e) => e.wireValue).toList(),
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
    'replayed': replayed,
  };
}

class VerificationFileObject {
  const VerificationFileObject({
    required this.objectId,
    required this.contentType,
    required this.byteSize,
    required this.sha256,
  });

  final UuidV7 objectId;
  final String contentType;
  final int byteSize;
  final Sha256Hex sha256;

  factory VerificationFileObject.fromJson(Map<String, Object?> json) => VerificationFileObject(
    objectId: json['object_id'] as String,
    contentType: json['content_type'] as String,
    byteSize: (json['byte_size'] as num).toInt(),
    sha256: json['sha256'] as String,
  );

  Map<String, Object?> toJson() => {
    'object_id': objectId,
    'content_type': contentType,
    'byte_size': byteSize,
    'sha256': sha256,
  };
}

class VerificationDownloadTarget {
  const VerificationDownloadTarget({
    required this.method,
    required this.url,
    required this.expiresAt,
    required this.requiredHeaders,
  });

  final String method;
  final String url;
  final Timestamp expiresAt;
  final Map<String, Object?> requiredHeaders;

  factory VerificationDownloadTarget.fromJson(Map<String, Object?> json) => VerificationDownloadTarget(
    method: json['method'] as String,
    url: json['url'] as String,
    expiresAt: json['expires_at'] as String,
    requiredHeaders: Map<String, Object?>.from(json['required_headers'] as Map),
  );

  Map<String, Object?> toJson() => {
    'method': method,
    'url': url,
    'expires_at': expiresAt,
    'required_headers': requiredHeaders,
  };
}

class VerificationFileDownloadResponse {
  const VerificationFileDownloadResponse({
    required this.object,
    required this.download,
  });

  final VerificationFileObject object;
  final VerificationDownloadTarget download;

  factory VerificationFileDownloadResponse.fromJson(Map<String, Object?> json) => VerificationFileDownloadResponse(
    object: VerificationFileObject.fromJson(json['object'] as Map<String, Object?>),
    download: VerificationDownloadTarget.fromJson(json['download'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'object': object.toJson(),
    'download': download.toJson(),
  };
}

class CheckInAppointmentRequest {
  const CheckInAppointmentRequest({
    required this.status,
    required this.expectedVersion,
  });

  final String status;
  final int expectedVersion;

  factory CheckInAppointmentRequest.fromJson(Map<String, Object?> json) => CheckInAppointmentRequest(
    status: json['status'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'expected_version': expectedVersion,
  };
}

class StartAppointmentRequest {
  const StartAppointmentRequest({
    required this.status,
    required this.expectedVersion,
  });

  final String status;
  final int expectedVersion;

  factory StartAppointmentRequest.fromJson(Map<String, Object?> json) => StartAppointmentRequest(
    status: json['status'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'expected_version': expectedVersion,
  };
}

enum ConsultationStatus {
  notStarted,
  ready,
  inProgress,
  completed,
  cancelled,
  unknown,
}

extension ConsultationStatusWire on ConsultationStatus {
  String get wireValue => switch (this) {
    ConsultationStatus.notStarted => 'not_started',
    ConsultationStatus.ready => 'ready',
    ConsultationStatus.inProgress => 'in_progress',
    ConsultationStatus.completed => 'completed',
    ConsultationStatus.cancelled => 'cancelled',
    ConsultationStatus.unknown => throw StateError('Cannot serialize unknown ConsultationStatus'),
  };
}

ConsultationStatus consultationStatusFromWire(String value) => switch (value) {
  'not_started' => ConsultationStatus.notStarted,
  'ready' => ConsultationStatus.ready,
  'in_progress' => ConsultationStatus.inProgress,
  'completed' => ConsultationStatus.completed,
  'cancelled' => ConsultationStatus.cancelled,
  _ => ConsultationStatus.unknown,
};

class Consultation {
  const Consultation({
    required this.consultationId,
    required this.appointmentId,
    required this.organizationId,
    required this.patientProfileId,
    required this.doctorMembershipId,
    required this.status,
    required this.outcomeCode,
    required this.version,
    required this.startedAt,
    required this.completedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 consultationId;
  final UuidV7 appointmentId;
  final UuidV7 organizationId;
  final UuidV7 patientProfileId;
  final UuidV7 doctorMembershipId;
  final ConsultationStatus status;
  final String? outcomeCode;
  final int version;
  final Timestamp? startedAt;
  final Timestamp? completedAt;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory Consultation.fromJson(Map<String, Object?> json) => Consultation(
    consultationId: json['consultation_id'] as String,
    appointmentId: json['appointment_id'] as String,
    organizationId: json['organization_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    doctorMembershipId: json['doctor_membership_id'] as String,
    status: consultationStatusFromWire(json['status'] as String),
    outcomeCode: json['outcome_code'] == null ? null : json['outcome_code'] as String,
    version: (json['version'] as num).toInt(),
    startedAt: json['started_at'] == null ? null : json['started_at'] as String,
    completedAt: json['completed_at'] == null ? null : json['completed_at'] as String,
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'consultation_id': consultationId,
    'appointment_id': appointmentId,
    'organization_id': organizationId,
    'patient_profile_id': patientProfileId,
    'doctor_membership_id': doctorMembershipId,
    'status': status.wireValue,
    'outcome_code': outcomeCode,
    'version': version,
    'started_at': startedAt,
    'completed_at': completedAt,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class ConsultationList {
  const ConsultationList({
    required this.data,
    required this.page,
  });

  final List<Consultation> data;
  final PageInfo page;

  factory ConsultationList.fromJson(Map<String, Object?> json) => ConsultationList(
    data: (json['data'] as List).map((e) => Consultation.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class ConsultationTransitionRequest {
  const ConsultationTransitionRequest({
    required this.status,
    required this.outcomeCode,
    required this.expectedVersion,
  });

  final String status;
  final String? outcomeCode;
  final int expectedVersion;

  factory ConsultationTransitionRequest.fromJson(Map<String, Object?> json) => ConsultationTransitionRequest(
    status: json['status'] as String,
    outcomeCode: json['outcome_code'] == null ? null : json['outcome_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'outcome_code': outcomeCode,
    'expected_version': expectedVersion,
  };
}

class ConsultationRoomToken {
  const ConsultationRoomToken({
    required this.serverUrl,
    required this.accessToken,
    required this.expiresAt,
  });

  final String serverUrl;
  final String accessToken;
  final Timestamp expiresAt;

  factory ConsultationRoomToken.fromJson(Map<String, Object?> json) => ConsultationRoomToken(
    serverUrl: json['server_url'] as String,
    accessToken: json['access_token'] as String,
    expiresAt: json['expires_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'server_url': serverUrl,
    'access_token': accessToken,
    'expires_at': expiresAt,
  };
}

enum ClinicalNoteStatus {
  draft,
  signed,
  superseded,
  discarded,
  unknown,
}

extension ClinicalNoteStatusWire on ClinicalNoteStatus {
  String get wireValue => switch (this) {
    ClinicalNoteStatus.draft => 'draft',
    ClinicalNoteStatus.signed => 'signed',
    ClinicalNoteStatus.superseded => 'superseded',
    ClinicalNoteStatus.discarded => 'discarded',
    ClinicalNoteStatus.unknown => throw StateError('Cannot serialize unknown ClinicalNoteStatus'),
  };
}

ClinicalNoteStatus clinicalNoteStatusFromWire(String value) => switch (value) {
  'draft' => ClinicalNoteStatus.draft,
  'signed' => ClinicalNoteStatus.signed,
  'superseded' => ClinicalNoteStatus.superseded,
  'discarded' => ClinicalNoteStatus.discarded,
  _ => ClinicalNoteStatus.unknown,
};

typedef ClinicalNoteContent = Map<String, Object?>;

class ClinicalNote {
  const ClinicalNote({
    required this.noteId,
    required this.consultationId,
    required this.authorMembershipId,
    required this.versionNo,
    required this.status,
    required this.content,
    required this.replacesNoteId,
    required this.signedAt,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 noteId;
  final UuidV7 consultationId;
  final UuidV7 authorMembershipId;
  final int versionNo;
  final ClinicalNoteStatus status;
  final ClinicalNoteContent content;
  final UuidV7? replacesNoteId;
  final Timestamp? signedAt;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory ClinicalNote.fromJson(Map<String, Object?> json) => ClinicalNote(
    noteId: json['note_id'] as String,
    consultationId: json['consultation_id'] as String,
    authorMembershipId: json['author_membership_id'] as String,
    versionNo: (json['version_no'] as num).toInt(),
    status: clinicalNoteStatusFromWire(json['status'] as String),
    content: json['content'] as Map<String, Object?>,
    replacesNoteId: json['replaces_note_id'] == null ? null : json['replaces_note_id'] as String,
    signedAt: json['signed_at'] == null ? null : json['signed_at'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'note_id': noteId,
    'consultation_id': consultationId,
    'author_membership_id': authorMembershipId,
    'version_no': versionNo,
    'status': status.wireValue,
    'content': content,
    'replaces_note_id': replacesNoteId,
    'signed_at': signedAt,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class ClinicalNoteList {
  const ClinicalNoteList({
    required this.data,
  });

  final List<ClinicalNote> data;

  factory ClinicalNoteList.fromJson(Map<String, Object?> json) => ClinicalNoteList(
    data: (json['data'] as List).map((e) => ClinicalNote.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class CreateClinicalNoteRequest {
  const CreateClinicalNoteRequest({
    required this.content,
  });

  final ClinicalNoteContent content;

  factory CreateClinicalNoteRequest.fromJson(Map<String, Object?> json) => CreateClinicalNoteRequest(
    content: json['content'] as Map<String, Object?>,
  );

  Map<String, Object?> toJson() => {
    'content': content,
  };
}

class UpdateClinicalNoteRequest {
  const UpdateClinicalNoteRequest({
    required this.content,
    required this.expectedVersion,
  });

  final ClinicalNoteContent content;
  final int expectedVersion;

  factory UpdateClinicalNoteRequest.fromJson(Map<String, Object?> json) => UpdateClinicalNoteRequest(
    content: json['content'] as Map<String, Object?>,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'content': content,
    'expected_version': expectedVersion,
  };
}

class TransitionClinicalNoteRequest {
  const TransitionClinicalNoteRequest({
    required this.status,
    required this.expectedVersion,
  });

  final String status;
  final int expectedVersion;

  factory TransitionClinicalNoteRequest.fromJson(Map<String, Object?> json) => TransitionClinicalNoteRequest(
    status: json['status'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'expected_version': expectedVersion,
  };
}

class AmendClinicalNoteRequest {
  const AmendClinicalNoteRequest({
    required this.content,
    required this.expectedVersion,
  });

  final ClinicalNoteContent content;
  final int expectedVersion;

  factory AmendClinicalNoteRequest.fromJson(Map<String, Object?> json) => AmendClinicalNoteRequest(
    content: json['content'] as Map<String, Object?>,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'content': content,
    'expected_version': expectedVersion,
  };
}

class Conversation {
  const Conversation({
    required this.conversationId,
    required this.consultationId,
    required this.status,
  });

  final UuidV7 conversationId;
  final UuidV7 consultationId;
  final String status;

  factory Conversation.fromJson(Map<String, Object?> json) => Conversation(
    conversationId: json['conversation_id'] as String,
    consultationId: json['consultation_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'conversation_id': conversationId,
    'consultation_id': consultationId,
    'status': status,
  };
}

enum MessageType {
  text,
  file,
  system,
  unknown,
}

extension MessageTypeWire on MessageType {
  String get wireValue => switch (this) {
    MessageType.text => 'text',
    MessageType.file => 'file',
    MessageType.system => 'system',
    MessageType.unknown => throw StateError('Cannot serialize unknown MessageType'),
  };
}

MessageType messageTypeFromWire(String value) => switch (value) {
  'text' => MessageType.text,
  'file' => MessageType.file,
  'system' => MessageType.system,
  _ => MessageType.unknown,
};

class Message {
  const Message({
    required this.messageId,
    required this.conversationId,
    required this.senderProfileId,
    required this.sequenceNo,
    required this.clientCorrelationId,
    required this.messageType,
    required this.textContent,
    required this.fileObjectId,
    required this.isMe,
    required this.deliveredAt,
    required this.readAt,
    required this.createdAt,
  });

  final UuidV7 messageId;
  final UuidV7 conversationId;
  final UuidV7 senderProfileId;
  final int sequenceNo;
  final UuidV7 clientCorrelationId;
  final MessageType messageType;
  final String? textContent;
  final UuidV7? fileObjectId;
  final bool isMe;
  final Timestamp? deliveredAt;
  final Timestamp? readAt;
  final Timestamp createdAt;

  factory Message.fromJson(Map<String, Object?> json) => Message(
    messageId: json['message_id'] as String,
    conversationId: json['conversation_id'] as String,
    senderProfileId: json['sender_profile_id'] as String,
    sequenceNo: (json['sequence_no'] as num).toInt(),
    clientCorrelationId: json['client_correlation_id'] as String,
    messageType: messageTypeFromWire(json['message_type'] as String),
    textContent: json['text_content'] == null ? null : json['text_content'] as String,
    fileObjectId: json['file_object_id'] == null ? null : json['file_object_id'] as String,
    isMe: json['is_me'] as bool,
    deliveredAt: json['delivered_at'] == null ? null : json['delivered_at'] as String,
    readAt: json['read_at'] == null ? null : json['read_at'] as String,
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'message_id': messageId,
    'conversation_id': conversationId,
    'sender_profile_id': senderProfileId,
    'sequence_no': sequenceNo,
    'client_correlation_id': clientCorrelationId,
    'message_type': messageType.wireValue,
    'text_content': textContent,
    'file_object_id': fileObjectId,
    'is_me': isMe,
    'delivered_at': deliveredAt,
    'read_at': readAt,
    'created_at': createdAt,
  };
}

class MessageList {
  const MessageList({
    required this.data,
    required this.page,
  });

  final List<Message> data;
  final PageInfo page;

  factory MessageList.fromJson(Map<String, Object?> json) => MessageList(
    data: (json['data'] as List).map((e) => Message.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class CreateMessageRequest {
  const CreateMessageRequest({
    required this.messageType,
    this.textContent,
    this.fileObjectId,
    required this.clientCorrelationId,
  });

  final String messageType;
  final String? textContent;
  final UuidV7? fileObjectId;
  final UuidV7 clientCorrelationId;

  factory CreateMessageRequest.fromJson(Map<String, Object?> json) => CreateMessageRequest(
    messageType: json['message_type'] as String,
    textContent: json['text_content'] == null ? null : json['text_content'] as String,
    fileObjectId: json['file_object_id'] == null ? null : json['file_object_id'] as String,
    clientCorrelationId: json['client_correlation_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'message_type': messageType,
    'text_content': textContent,
    'file_object_id': fileObjectId,
    'client_correlation_id': clientCorrelationId,
  };
}

class MarkConversationReadRequest {
  const MarkConversationReadRequest({
    required this.throughSequenceNo,
  });

  final int throughSequenceNo;

  factory MarkConversationReadRequest.fromJson(Map<String, Object?> json) => MarkConversationReadRequest(
    throughSequenceNo: (json['through_sequence_no'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'through_sequence_no': throughSequenceNo,
  };
}

class MarkConversationReadResult {
  const MarkConversationReadResult({
    required this.updatedReceipts,
    required this.throughSequenceNo,
  });

  final int updatedReceipts;
  final int throughSequenceNo;

  factory MarkConversationReadResult.fromJson(Map<String, Object?> json) => MarkConversationReadResult(
    updatedReceipts: (json['updated_receipts'] as num).toInt(),
    throughSequenceNo: (json['through_sequence_no'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'updated_receipts': updatedReceipts,
    'through_sequence_no': throughSequenceNo,
  };
}

enum PrescriptionStatus {
  draft,
  signed,
  superseded,
  cancelled,
  expired,
  discarded,
  unknown,
}

extension PrescriptionStatusWire on PrescriptionStatus {
  String get wireValue => switch (this) {
    PrescriptionStatus.draft => 'draft',
    PrescriptionStatus.signed => 'signed',
    PrescriptionStatus.superseded => 'superseded',
    PrescriptionStatus.cancelled => 'cancelled',
    PrescriptionStatus.expired => 'expired',
    PrescriptionStatus.discarded => 'discarded',
    PrescriptionStatus.unknown => throw StateError('Cannot serialize unknown PrescriptionStatus'),
  };
}

PrescriptionStatus prescriptionStatusFromWire(String value) => switch (value) {
  'draft' => PrescriptionStatus.draft,
  'signed' => PrescriptionStatus.signed,
  'superseded' => PrescriptionStatus.superseded,
  'cancelled' => PrescriptionStatus.cancelled,
  'expired' => PrescriptionStatus.expired,
  'discarded' => PrescriptionStatus.discarded,
  _ => PrescriptionStatus.unknown,
};

class PrescriptionItemInput {
  const PrescriptionItemInput({
    required this.medicationReference,
    required this.medicationText,
    required this.doseValue,
    required this.doseUnit,
    required this.routeCode,
    required this.frequencyCode,
    required this.frequencyText,
    required this.durationDays,
    required this.patientInstructions,
  });

  final String? medicationReference;
  final String? medicationText;
  final String doseValue;
  final String doseUnit;
  final String routeCode;
  final String? frequencyCode;
  final String? frequencyText;
  final int durationDays;
  final String? patientInstructions;

  factory PrescriptionItemInput.fromJson(Map<String, Object?> json) => PrescriptionItemInput(
    medicationReference: json['medication_reference'] == null ? null : json['medication_reference'] as String,
    medicationText: json['medication_text'] == null ? null : json['medication_text'] as String,
    doseValue: json['dose_value'] as String,
    doseUnit: json['dose_unit'] as String,
    routeCode: json['route_code'] as String,
    frequencyCode: json['frequency_code'] == null ? null : json['frequency_code'] as String,
    frequencyText: json['frequency_text'] == null ? null : json['frequency_text'] as String,
    durationDays: (json['duration_days'] as num).toInt(),
    patientInstructions: json['patient_instructions'] == null ? null : json['patient_instructions'] as String,
  );

  Map<String, Object?> toJson() => {
    'medication_reference': medicationReference,
    'medication_text': medicationText,
    'dose_value': doseValue,
    'dose_unit': doseUnit,
    'route_code': routeCode,
    'frequency_code': frequencyCode,
    'frequency_text': frequencyText,
    'duration_days': durationDays,
    'patient_instructions': patientInstructions,
  };
}

typedef PrescriptionItem = String;

class Prescription {
  const Prescription({
    required this.prescriptionId,
    required this.consultationId,
    required this.patientProfileId,
    required this.doctorMembershipId,
    required this.status,
    required this.replacesPrescriptionId,
    required this.diagnosis,
    required this.cancellationReasonCode,
    required this.signedAt,
    required this.expiresAt,
    required this.version,
    required this.documentStatus,
    required this.items,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 prescriptionId;
  final UuidV7 consultationId;
  final UuidV7 patientProfileId;
  final UuidV7 doctorMembershipId;
  final PrescriptionStatus status;
  final UuidV7? replacesPrescriptionId;
  final String? diagnosis;
  final String? cancellationReasonCode;
  final Timestamp? signedAt;
  final Timestamp? expiresAt;
  final int version;
  final String? documentStatus;
  final List<PrescriptionItem> items;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory Prescription.fromJson(Map<String, Object?> json) => Prescription(
    prescriptionId: json['prescription_id'] as String,
    consultationId: json['consultation_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    doctorMembershipId: json['doctor_membership_id'] as String,
    status: prescriptionStatusFromWire(json['status'] as String),
    replacesPrescriptionId: json['replaces_prescription_id'] == null ? null : json['replaces_prescription_id'] as String,
    diagnosis: json['diagnosis'] == null ? null : json['diagnosis'] as String,
    cancellationReasonCode: json['cancellation_reason_code'] == null ? null : json['cancellation_reason_code'] as String,
    signedAt: json['signed_at'] == null ? null : json['signed_at'] as String,
    expiresAt: json['expires_at'] == null ? null : json['expires_at'] as String,
    version: (json['version'] as num).toInt(),
    documentStatus: json['document_status'] == null ? null : json['document_status'] as String,
    items: List<String>.from(json['items'] as List),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'prescription_id': prescriptionId,
    'consultation_id': consultationId,
    'patient_profile_id': patientProfileId,
    'doctor_membership_id': doctorMembershipId,
    'status': status.wireValue,
    'replaces_prescription_id': replacesPrescriptionId,
    'diagnosis': diagnosis,
    'cancellation_reason_code': cancellationReasonCode,
    'signed_at': signedAt,
    'expires_at': expiresAt,
    'version': version,
    'document_status': documentStatus,
    'items': items,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class CreatePrescriptionRequest {
  const CreatePrescriptionRequest({
    required this.items,
    this.diagnosis,
  });

  final List<PrescriptionItemInput> items;
  final String? diagnosis;

  factory CreatePrescriptionRequest.fromJson(Map<String, Object?> json) => CreatePrescriptionRequest(
    items: (json['items'] as List).map((e) => PrescriptionItemInput.fromJson(e as Map<String, Object?>)).toList(),
    diagnosis: json['diagnosis'] == null ? null : json['diagnosis'] as String,
  );

  Map<String, Object?> toJson() => {
    'items': items.map((e) => e.toJson()).toList(),
    'diagnosis': diagnosis,
  };
}

class UpdatePrescriptionRequest {
  const UpdatePrescriptionRequest({
    required this.items,
    this.diagnosis,
    required this.expectedVersion,
  });

  final List<PrescriptionItemInput> items;
  final String? diagnosis;
  final int expectedVersion;

  factory UpdatePrescriptionRequest.fromJson(Map<String, Object?> json) => UpdatePrescriptionRequest(
    items: (json['items'] as List).map((e) => PrescriptionItemInput.fromJson(e as Map<String, Object?>)).toList(),
    diagnosis: json['diagnosis'] == null ? null : json['diagnosis'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'items': items.map((e) => e.toJson()).toList(),
    'diagnosis': diagnosis,
    'expected_version': expectedVersion,
  };
}

class TransitionPrescriptionRequest {
  const TransitionPrescriptionRequest({
    required this.status,
    required this.expectedVersion,
    required this.expiresAt,
  });

  final String status;
  final int expectedVersion;
  final Timestamp? expiresAt;

  factory TransitionPrescriptionRequest.fromJson(Map<String, Object?> json) => TransitionPrescriptionRequest(
    status: json['status'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
    expiresAt: json['expires_at'] == null ? null : json['expires_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'expected_version': expectedVersion,
    'expires_at': expiresAt,
  };
}

class SupersedePrescriptionRequest {
  const SupersedePrescriptionRequest({
    required this.items,
    this.diagnosis,
    required this.expectedVersion,
    required this.expiresAt,
  });

  final List<PrescriptionItemInput> items;
  final String? diagnosis;
  final int expectedVersion;
  final Timestamp? expiresAt;

  factory SupersedePrescriptionRequest.fromJson(Map<String, Object?> json) => SupersedePrescriptionRequest(
    items: (json['items'] as List).map((e) => PrescriptionItemInput.fromJson(e as Map<String, Object?>)).toList(),
    diagnosis: json['diagnosis'] == null ? null : json['diagnosis'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
    expiresAt: json['expires_at'] == null ? null : json['expires_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'items': items.map((e) => e.toJson()).toList(),
    'diagnosis': diagnosis,
    'expected_version': expectedVersion,
    'expires_at': expiresAt,
  };
}

class CancelPrescriptionRequest {
  const CancelPrescriptionRequest({
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String reasonCode;
  final int expectedVersion;

  factory CancelPrescriptionRequest.fromJson(Map<String, Object?> json) => CancelPrescriptionRequest(
    reasonCode: json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

enum NotificationCategory {
  accountSecurity,
  appointments,
  consultations,
  messages,
  prescriptions,
  vitalsAlerts,
  aiReview,
  delivery,
  dispatch,
  emergency,
  system,
  vitalsUpdate,
  unknown,
}

extension NotificationCategoryWire on NotificationCategory {
  String get wireValue => switch (this) {
    NotificationCategory.accountSecurity => 'account_security',
    NotificationCategory.appointments => 'appointments',
    NotificationCategory.consultations => 'consultations',
    NotificationCategory.messages => 'messages',
    NotificationCategory.prescriptions => 'prescriptions',
    NotificationCategory.vitalsAlerts => 'vitals_alerts',
    NotificationCategory.aiReview => 'ai_review',
    NotificationCategory.delivery => 'delivery',
    NotificationCategory.dispatch => 'dispatch',
    NotificationCategory.emergency => 'emergency',
    NotificationCategory.system => 'system',
    NotificationCategory.vitalsUpdate => 'vitals_update',
    NotificationCategory.unknown => throw StateError('Cannot serialize unknown NotificationCategory'),
  };
}

NotificationCategory notificationCategoryFromWire(String value) => switch (value) {
  'account_security' => NotificationCategory.accountSecurity,
  'appointments' => NotificationCategory.appointments,
  'consultations' => NotificationCategory.consultations,
  'messages' => NotificationCategory.messages,
  'prescriptions' => NotificationCategory.prescriptions,
  'vitals_alerts' => NotificationCategory.vitalsAlerts,
  'ai_review' => NotificationCategory.aiReview,
  'delivery' => NotificationCategory.delivery,
  'dispatch' => NotificationCategory.dispatch,
  'emergency' => NotificationCategory.emergency,
  'system' => NotificationCategory.system,
  'vitals_update' => NotificationCategory.vitalsUpdate,
  _ => NotificationCategory.unknown,
};

enum NotificationPriority {
  low,
  normal,
  high,
  critical,
  unknown,
}

extension NotificationPriorityWire on NotificationPriority {
  String get wireValue => switch (this) {
    NotificationPriority.low => 'low',
    NotificationPriority.normal => 'normal',
    NotificationPriority.high => 'high',
    NotificationPriority.critical => 'critical',
    NotificationPriority.unknown => throw StateError('Cannot serialize unknown NotificationPriority'),
  };
}

NotificationPriority notificationPriorityFromWire(String value) => switch (value) {
  'low' => NotificationPriority.low,
  'normal' => NotificationPriority.normal,
  'high' => NotificationPriority.high,
  'critical' => NotificationPriority.critical,
  _ => NotificationPriority.unknown,
};

class Notification {
  const Notification({
    required this.notificationId,
    required this.category,
    required this.resourceType,
    required this.resourceId,
    required this.titleCode,
    required this.bodyCode,
    required this.priority,
    required this.expiresAt,
    required this.readAt,
    required this.createdAt,
  });

  final UuidV7 notificationId;
  final NotificationCategory category;
  final String resourceType;
  final UuidV7 resourceId;
  final String titleCode;
  final String bodyCode;
  final NotificationPriority priority;
  final String expiresAt;
  final Timestamp? readAt;
  final Timestamp createdAt;

  factory Notification.fromJson(Map<String, Object?> json) => Notification(
    notificationId: json['notification_id'] as String,
    category: notificationCategoryFromWire(json['category'] as String),
    resourceType: json['resource_type'] as String,
    resourceId: json['resource_id'] as String,
    titleCode: json['title_code'] as String,
    bodyCode: json['body_code'] as String,
    priority: notificationPriorityFromWire(json['priority'] as String),
    expiresAt: json['expires_at'] as String,
    readAt: json['read_at'] == null ? null : json['read_at'] as String,
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'notification_id': notificationId,
    'category': category.wireValue,
    'resource_type': resourceType,
    'resource_id': resourceId,
    'title_code': titleCode,
    'body_code': bodyCode,
    'priority': priority.wireValue,
    'expires_at': expiresAt,
    'read_at': readAt,
    'created_at': createdAt,
  };
}

class NotificationList {
  const NotificationList({
    required this.data,
    required this.page,
  });

  final List<Notification> data;
  final PageInfo page;

  factory NotificationList.fromJson(Map<String, Object?> json) => NotificationList(
    data: (json['data'] as List).map((e) => Notification.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class NotificationPreference {
  const NotificationPreference({
    required this.category,
    required this.channel,
    required this.enabled,
    required this.quietHoursStart,
    required this.quietHoursEnd,
    required this.timezone,
  });

  final NotificationCategory category;
  final String channel;
  final bool enabled;
  final String? quietHoursStart;
  final String? quietHoursEnd;
  final String timezone;

  factory NotificationPreference.fromJson(Map<String, Object?> json) => NotificationPreference(
    category: notificationCategoryFromWire(json['category'] as String),
    channel: json['channel'] as String,
    enabled: json['enabled'] as bool,
    quietHoursStart: json['quiet_hours_start'] == null ? null : json['quiet_hours_start'] as String,
    quietHoursEnd: json['quiet_hours_end'] == null ? null : json['quiet_hours_end'] as String,
    timezone: json['timezone'] as String,
  );

  Map<String, Object?> toJson() => {
    'category': category.wireValue,
    'channel': channel,
    'enabled': enabled,
    'quiet_hours_start': quietHoursStart,
    'quiet_hours_end': quietHoursEnd,
    'timezone': timezone,
  };
}

class NotificationPreferenceList {
  const NotificationPreferenceList({
    required this.data,
  });

  final List<NotificationPreference> data;

  factory NotificationPreferenceList.fromJson(Map<String, Object?> json) => NotificationPreferenceList(
    data: (json['data'] as List).map((e) => NotificationPreference.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class RegisterPushDeviceRequest {
  const RegisterPushDeviceRequest({
    required this.platform,
    required this.token,
  });

  final String platform;
  final String token;

  factory RegisterPushDeviceRequest.fromJson(Map<String, Object?> json) => RegisterPushDeviceRequest(
    platform: json['platform'] as String,
    token: json['token'] as String,
  );

  Map<String, Object?> toJson() => {
    'platform': platform,
    'token': token,
  };
}

class PushDevice {
  const PushDevice({
    required this.pushDeviceId,
    required this.platform,
    required this.enabled,
  });

  final UuidV7 pushDeviceId;
  final String platform;
  final bool enabled;

  factory PushDevice.fromJson(Map<String, Object?> json) => PushDevice(
    pushDeviceId: json['push_device_id'] as String,
    platform: json['platform'] as String,
    enabled: json['enabled'] as bool,
  );

  Map<String, Object?> toJson() => {
    'push_device_id': pushDeviceId,
    'platform': platform,
    'enabled': enabled,
  };
}

enum ReadingSource {
  device,
  manual,
  imported,
  derived,
  unknown,
}

extension ReadingSourceWire on ReadingSource {
  String get wireValue => switch (this) {
    ReadingSource.device => 'device',
    ReadingSource.manual => 'manual',
    ReadingSource.imported => 'imported',
    ReadingSource.derived => 'derived',
    ReadingSource.unknown => throw StateError('Cannot serialize unknown ReadingSource'),
  };
}

ReadingSource readingSourceFromWire(String value) => switch (value) {
  'device' => ReadingSource.device,
  'manual' => ReadingSource.manual,
  'imported' => ReadingSource.imported,
  'derived' => ReadingSource.derived,
  _ => ReadingSource.unknown,
};

class TransitionHealthAlertRequest {
  const TransitionHealthAlertRequest({
    required this.state,
    required this.reasonCode,
    required this.escalatedToMembershipId,
    required this.expectedVersion,
  });

  final String state;
  final String reasonCode;
  final UuidV7? escalatedToMembershipId;
  final int expectedVersion;

  factory TransitionHealthAlertRequest.fromJson(Map<String, Object?> json) => TransitionHealthAlertRequest(
    state: json['state'] as String,
    reasonCode: json['reason_code'] as String,
    escalatedToMembershipId: json['escalated_to_membership_id'] == null ? null : json['escalated_to_membership_id'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'state': state,
    'reason_code': reasonCode,
    'escalated_to_membership_id': escalatedToMembershipId,
    'expected_version': expectedVersion,
  };
}

enum AiArtifactType {
  symptomSummary,
  careNavigation,
  healthSummary,
  dailySummary,
  trendAnalysis,
  riskFlag,
  forecast,
  anomaly,
  unknown,
}

extension AiArtifactTypeWire on AiArtifactType {
  String get wireValue => switch (this) {
    AiArtifactType.symptomSummary => 'symptom_summary',
    AiArtifactType.careNavigation => 'care_navigation',
    AiArtifactType.healthSummary => 'health_summary',
    AiArtifactType.dailySummary => 'daily_summary',
    AiArtifactType.trendAnalysis => 'trend_analysis',
    AiArtifactType.riskFlag => 'risk_flag',
    AiArtifactType.forecast => 'forecast',
    AiArtifactType.anomaly => 'anomaly',
    AiArtifactType.unknown => throw StateError('Cannot serialize unknown AiArtifactType'),
  };
}

AiArtifactType aiArtifactTypeFromWire(String value) => switch (value) {
  'symptom_summary' => AiArtifactType.symptomSummary,
  'care_navigation' => AiArtifactType.careNavigation,
  'health_summary' => AiArtifactType.healthSummary,
  'daily_summary' => AiArtifactType.dailySummary,
  'trend_analysis' => AiArtifactType.trendAnalysis,
  'risk_flag' => AiArtifactType.riskFlag,
  'forecast' => AiArtifactType.forecast,
  'anomaly' => AiArtifactType.anomaly,
  _ => AiArtifactType.unknown,
};

enum AiReviewStatus {
  pendingReview,
  approved,
  rejected,
  superseded,
  unknown,
}

extension AiReviewStatusWire on AiReviewStatus {
  String get wireValue => switch (this) {
    AiReviewStatus.pendingReview => 'pending_review',
    AiReviewStatus.approved => 'approved',
    AiReviewStatus.rejected => 'rejected',
    AiReviewStatus.superseded => 'superseded',
    AiReviewStatus.unknown => throw StateError('Cannot serialize unknown AiReviewStatus'),
  };
}

AiReviewStatus aiReviewStatusFromWire(String value) => switch (value) {
  'pending_review' => AiReviewStatus.pendingReview,
  'approved' => AiReviewStatus.approved,
  'rejected' => AiReviewStatus.rejected,
  'superseded' => AiReviewStatus.superseded,
  _ => AiReviewStatus.unknown,
};

enum AiRiskLevel {
  unknown,
  low,
  moderate,
  high,
  critical,
}

extension AiRiskLevelWire on AiRiskLevel {
  String get wireValue => switch (this) {
    AiRiskLevel.unknown => 'unknown',
    AiRiskLevel.low => 'low',
    AiRiskLevel.moderate => 'moderate',
    AiRiskLevel.high => 'high',
    AiRiskLevel.critical => 'critical',
  };
}

AiRiskLevel aiRiskLevelFromWire(String value) => switch (value) {
  'unknown' => AiRiskLevel.unknown,
  'low' => AiRiskLevel.low,
  'moderate' => AiRiskLevel.moderate,
  'high' => AiRiskLevel.high,
  'critical' => AiRiskLevel.critical,
  _ => AiRiskLevel.unknown,
};

class AiArtifactSource {
  const AiArtifactSource({
    required this.chunkId,
    required this.rank,
  });

  final UuidV7 chunkId;
  final int rank;

  factory AiArtifactSource.fromJson(Map<String, Object?> json) => AiArtifactSource(
    chunkId: json['chunk_id'] as String,
    rank: (json['rank'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'chunk_id': chunkId,
    'rank': rank,
  };
}

class AiArtifactContent {
  const AiArtifactContent({
    required this.nonDiagnostic,
    this.summaryOfReportedSymptoms,
    this.suggestedNextStep,
    this.informationOnlyNotice,
    this.sources,
  });

  final bool nonDiagnostic;
  final List<String>? summaryOfReportedSymptoms;
  final String? suggestedNextStep;
  final String? informationOnlyNotice;
  final List<AiArtifactSource>? sources;

  factory AiArtifactContent.fromJson(Map<String, Object?> json) => AiArtifactContent(
    nonDiagnostic: json['non_diagnostic'] as bool,
    summaryOfReportedSymptoms: json['summary_of_reported_symptoms'] == null ? null : List<String>.from(json['summary_of_reported_symptoms'] as List),
    suggestedNextStep: json['suggested_next_step'] == null ? null : json['suggested_next_step'] as String,
    informationOnlyNotice: json['information_only_notice'] == null ? null : json['information_only_notice'] as String,
    sources: json['sources'] == null ? null : (json['sources'] as List).map((e) => AiArtifactSource.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'non_diagnostic': nonDiagnostic,
    'summary_of_reported_symptoms': summaryOfReportedSymptoms,
    'suggested_next_step': suggestedNextStep,
    'information_only_notice': informationOnlyNotice,
    'sources': sources?.map((e) => e.toJson()).toList(),
  };
}

class AiArtifact {
  const AiArtifact({
    required this.artifactId,
    required this.generationId,
    required this.patientProfileId,
    required this.artifactType,
    required this.versionNo,
    required this.reviewStatus,
    required this.riskLevel,
    required this.confidence,
    required this.content,
    required this.modelId,
    required this.promptTemplateId,
    required this.replacesArtifactId,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 artifactId;
  final UuidV7 generationId;
  final UuidV7 patientProfileId;
  final AiArtifactType artifactType;
  final int versionNo;
  final AiReviewStatus reviewStatus;
  final AiRiskLevel riskLevel;
  final double? confidence;
  final AiArtifactContent content;
  final UuidV7 modelId;
  final UuidV7 promptTemplateId;
  final UuidV7? replacesArtifactId;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory AiArtifact.fromJson(Map<String, Object?> json) => AiArtifact(
    artifactId: json['artifact_id'] as String,
    generationId: json['generation_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    artifactType: aiArtifactTypeFromWire(json['artifact_type'] as String),
    versionNo: (json['version_no'] as num).toInt(),
    reviewStatus: aiReviewStatusFromWire(json['review_status'] as String),
    riskLevel: aiRiskLevelFromWire(json['risk_level'] as String),
    confidence: json['confidence'] == null ? null : (json['confidence'] as num).toDouble(),
    content: AiArtifactContent.fromJson(json['content'] as Map<String, Object?>),
    modelId: json['model_id'] as String,
    promptTemplateId: json['prompt_template_id'] as String,
    replacesArtifactId: json['replaces_artifact_id'] == null ? null : json['replaces_artifact_id'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'artifact_id': artifactId,
    'generation_id': generationId,
    'patient_profile_id': patientProfileId,
    'artifact_type': artifactType.wireValue,
    'version_no': versionNo,
    'review_status': reviewStatus.wireValue,
    'risk_level': riskLevel.wireValue,
    'confidence': confidence,
    'content': content.toJson(),
    'model_id': modelId,
    'prompt_template_id': promptTemplateId,
    'replaces_artifact_id': replacesArtifactId,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class AiConversation {
  const AiConversation({
    required this.conversationId,
    required this.status,
  });

  final UuidV7 conversationId;
  final String status;

  factory AiConversation.fromJson(Map<String, Object?> json) => AiConversation(
    conversationId: json['conversation_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'conversation_id': conversationId,
    'status': status,
  };
}

class SubmitAiTurnRequest {
  const SubmitAiTurnRequest({
    required this.content,
    required this.artifactType,
    required this.clientCorrelationId,
  });

  final String content;
  final String artifactType;
  final UuidV7 clientCorrelationId;

  factory SubmitAiTurnRequest.fromJson(Map<String, Object?> json) => SubmitAiTurnRequest(
    content: json['content'] as String,
    artifactType: json['artifact_type'] as String,
    clientCorrelationId: json['client_correlation_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'content': content,
    'artifact_type': artifactType,
    'client_correlation_id': clientCorrelationId,
  };
}

class AiGenerationAccepted {
  const AiGenerationAccepted({
    required this.generationId,
    required this.sequenceNo,
    required this.status,
  });

  final UuidV7 generationId;
  final int sequenceNo;
  final String status;

  factory AiGenerationAccepted.fromJson(Map<String, Object?> json) => AiGenerationAccepted(
    generationId: json['generation_id'] as String,
    sequenceNo: (json['sequence_no'] as num).toInt(),
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'generation_id': generationId,
    'sequence_no': sequenceNo,
    'status': status,
  };
}

class ReviewAiArtifactRequest {
  const ReviewAiArtifactRequest({
    required this.decision,
    required this.rationaleCode,
    required this.expectedVersion,
  });

  final String decision;
  final String rationaleCode;
  final int expectedVersion;

  factory ReviewAiArtifactRequest.fromJson(Map<String, Object?> json) => ReviewAiArtifactRequest(
    decision: json['decision'] as String,
    rationaleCode: json['rationale_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'decision': decision,
    'rationale_code': rationaleCode,
    'expected_version': expectedVersion,
  };
}

enum PharmacyOrderStatus {
  received,
  awaitingValidation,
  validated,
  stockReserved,
  fulfilling,
  readyForDispatch,
  dispatched,
  delivered,
  deliveryException,
  returned,
  rejected,
  cancelled,
  unknown,
}

extension PharmacyOrderStatusWire on PharmacyOrderStatus {
  String get wireValue => switch (this) {
    PharmacyOrderStatus.received => 'received',
    PharmacyOrderStatus.awaitingValidation => 'awaiting_validation',
    PharmacyOrderStatus.validated => 'validated',
    PharmacyOrderStatus.stockReserved => 'stock_reserved',
    PharmacyOrderStatus.fulfilling => 'fulfilling',
    PharmacyOrderStatus.readyForDispatch => 'ready_for_dispatch',
    PharmacyOrderStatus.dispatched => 'dispatched',
    PharmacyOrderStatus.delivered => 'delivered',
    PharmacyOrderStatus.deliveryException => 'delivery_exception',
    PharmacyOrderStatus.returned => 'returned',
    PharmacyOrderStatus.rejected => 'rejected',
    PharmacyOrderStatus.cancelled => 'cancelled',
    PharmacyOrderStatus.unknown => throw StateError('Cannot serialize unknown PharmacyOrderStatus'),
  };
}

PharmacyOrderStatus pharmacyOrderStatusFromWire(String value) => switch (value) {
  'received' => PharmacyOrderStatus.received,
  'awaiting_validation' => PharmacyOrderStatus.awaitingValidation,
  'validated' => PharmacyOrderStatus.validated,
  'stock_reserved' => PharmacyOrderStatus.stockReserved,
  'fulfilling' => PharmacyOrderStatus.fulfilling,
  'ready_for_dispatch' => PharmacyOrderStatus.readyForDispatch,
  'dispatched' => PharmacyOrderStatus.dispatched,
  'delivered' => PharmacyOrderStatus.delivered,
  'delivery_exception' => PharmacyOrderStatus.deliveryException,
  'returned' => PharmacyOrderStatus.returned,
  'rejected' => PharmacyOrderStatus.rejected,
  'cancelled' => PharmacyOrderStatus.cancelled,
  _ => PharmacyOrderStatus.unknown,
};

class BatchAvailability {
  const BatchAvailability({
    required this.batchId,
    required this.expiresOn,
    required this.postedQuantity,
    required this.reservedQuantity,
    required this.availableQuantity,
  });

  final UuidV7 batchId;
  final String expiresOn;
  final int postedQuantity;
  final int reservedQuantity;
  final int availableQuantity;

  factory BatchAvailability.fromJson(Map<String, Object?> json) => BatchAvailability(
    batchId: json['batch_id'] as String,
    expiresOn: json['expires_on'] as String,
    postedQuantity: (json['posted_quantity'] as num).toInt(),
    reservedQuantity: (json['reserved_quantity'] as num).toInt(),
    availableQuantity: (json['available_quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'batch_id': batchId,
    'expires_on': expiresOn,
    'posted_quantity': postedQuantity,
    'reserved_quantity': reservedQuantity,
    'available_quantity': availableQuantity,
  };
}

class InventoryAvailability {
  const InventoryAvailability({
    required this.siteId,
    required this.variantId,
    required this.data,
    required this.totalAvailableQuantity,
  });

  final UuidV7 siteId;
  final UuidV7 variantId;
  final List<BatchAvailability> data;
  final int totalAvailableQuantity;

  factory InventoryAvailability.fromJson(Map<String, Object?> json) => InventoryAvailability(
    siteId: json['site_id'] as String,
    variantId: json['variant_id'] as String,
    data: (json['data'] as List).map((e) => BatchAvailability.fromJson(e as Map<String, Object?>)).toList(),
    totalAvailableQuantity: (json['total_available_quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'site_id': siteId,
    'variant_id': variantId,
    'data': data.map((e) => e.toJson()).toList(),
    'total_available_quantity': totalAvailableQuantity,
  };
}

class ValidatePharmacyOrderRequest {
  const ValidatePharmacyOrderRequest({
    required this.state,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String state;
  final String? reasonCode;
  final int expectedVersion;

  factory ValidatePharmacyOrderRequest.fromJson(Map<String, Object?> json) => ValidatePharmacyOrderRequest(
    state: json['state'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'state': state,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class PharmacyReservationLine {
  const PharmacyReservationLine({
    required this.batchId,
    required this.quantity,
  });

  final UuidV7 batchId;
  final int quantity;

  factory PharmacyReservationLine.fromJson(Map<String, Object?> json) => PharmacyReservationLine(
    batchId: json['batch_id'] as String,
    quantity: (json['quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'batch_id': batchId,
    'quantity': quantity,
  };
}

class PharmacyValidationResult {
  const PharmacyValidationResult({
    required this.pharmacyOrderId,
    required this.status,
    required this.reservations,
    required this.shortfallOrderItemIds,
  });

  final UuidV7 pharmacyOrderId;
  final PharmacyOrderStatus status;
  final List<PharmacyReservationLine> reservations;
  final List<UuidV7> shortfallOrderItemIds;

  factory PharmacyValidationResult.fromJson(Map<String, Object?> json) => PharmacyValidationResult(
    pharmacyOrderId: json['pharmacy_order_id'] as String,
    status: pharmacyOrderStatusFromWire(json['status'] as String),
    reservations: (json['reservations'] as List).map((e) => PharmacyReservationLine.fromJson(e as Map<String, Object?>)).toList(),
    shortfallOrderItemIds: List<String>.from(json['shortfall_order_item_ids'] as List),
  );

  Map<String, Object?> toJson() => {
    'pharmacy_order_id': pharmacyOrderId,
    'status': status.wireValue,
    'reservations': reservations.map((e) => e.toJson()).toList(),
    'shortfall_order_item_ids': shortfallOrderItemIds,
  };
}

class TransitionPharmacyOrderRequest {
  const TransitionPharmacyOrderRequest({
    required this.status,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String status;
  final String? reasonCode;
  final int expectedVersion;

  factory TransitionPharmacyOrderRequest.fromJson(Map<String, Object?> json) => TransitionPharmacyOrderRequest(
    status: json['status'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class PharmacyOrderState {
  const PharmacyOrderState({
    required this.pharmacyOrderId,
    required this.status,
  });

  final UuidV7 pharmacyOrderId;
  final PharmacyOrderStatus status;

  factory PharmacyOrderState.fromJson(Map<String, Object?> json) => PharmacyOrderState(
    pharmacyOrderId: json['pharmacy_order_id'] as String,
    status: pharmacyOrderStatusFromWire(json['status'] as String),
  );

  Map<String, Object?> toJson() => {
    'pharmacy_order_id': pharmacyOrderId,
    'status': status.wireValue,
  };
}

class ExpectedVersionRequest {
  const ExpectedVersionRequest({
    required this.expectedVersion,
  });

  final int expectedVersion;

  factory ExpectedVersionRequest.fromJson(Map<String, Object?> json) => ExpectedVersionRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
  };
}

class DispatchOfferSummary {
  const DispatchOfferSummary({
    required this.offerId,
    required this.dispatchJobId,
    required this.feeSen,
    required this.currency,
    required this.approxDistanceMetres,
    required this.expiresAt,
    required this.version,
  });

  final UuidV7 offerId;
  final UuidV7 dispatchJobId;
  final int feeSen;
  final String currency;
  final int? approxDistanceMetres;
  final Timestamp expiresAt;
  final int version;

  factory DispatchOfferSummary.fromJson(Map<String, Object?> json) => DispatchOfferSummary(
    offerId: json['offer_id'] as String,
    dispatchJobId: json['dispatch_job_id'] as String,
    feeSen: (json['fee_sen'] as num).toInt(),
    currency: json['currency'] as String,
    approxDistanceMetres: json['approx_distance_metres'] == null ? null : (json['approx_distance_metres'] as num).toInt(),
    expiresAt: json['expires_at'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'offer_id': offerId,
    'dispatch_job_id': dispatchJobId,
    'fee_sen': feeSen,
    'currency': currency,
    'approx_distance_metres': approxDistanceMetres,
    'expires_at': expiresAt,
    'version': version,
  };
}

class DispatchOfferList {
  const DispatchOfferList({
    required this.data,
  });

  final List<DispatchOfferSummary> data;

  factory DispatchOfferList.fromJson(Map<String, Object?> json) => DispatchOfferList(
    data: (json['data'] as List).map((e) => DispatchOfferSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class AcceptDispatchOfferRequest {
  const AcceptDispatchOfferRequest({
    required this.vehicleId,
    required this.expectedVersion,
  });

  final UuidV7? vehicleId;
  final int expectedVersion;

  factory AcceptDispatchOfferRequest.fromJson(Map<String, Object?> json) => AcceptDispatchOfferRequest(
    vehicleId: json['vehicle_id'] == null ? null : json['vehicle_id'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'vehicle_id': vehicleId,
    'expected_version': expectedVersion,
  };
}

class DispatchAssignmentCreated {
  const DispatchAssignmentCreated({
    required this.assignmentId,
    required this.dispatchJobId,
    required this.status,
    required this.version,
  });

  final UuidV7 assignmentId;
  final UuidV7 dispatchJobId;
  final String status;
  final int version;

  factory DispatchAssignmentCreated.fromJson(Map<String, Object?> json) => DispatchAssignmentCreated(
    assignmentId: json['assignment_id'] as String,
    dispatchJobId: json['dispatch_job_id'] as String,
    status: json['status'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'assignment_id': assignmentId,
    'dispatch_job_id': dispatchJobId,
    'status': status,
    'version': version,
  };
}

enum DispatchAssignmentStatus {
  assigned,
  enRoutePickup,
  arrivedPickup,
  pickedUp,
  enRouteDropoff,
  arrivedDropoff,
  completed,
  cancelled,
  failed,
  unknown,
}

extension DispatchAssignmentStatusWire on DispatchAssignmentStatus {
  String get wireValue => switch (this) {
    DispatchAssignmentStatus.assigned => 'assigned',
    DispatchAssignmentStatus.enRoutePickup => 'en_route_pickup',
    DispatchAssignmentStatus.arrivedPickup => 'arrived_pickup',
    DispatchAssignmentStatus.pickedUp => 'picked_up',
    DispatchAssignmentStatus.enRouteDropoff => 'en_route_dropoff',
    DispatchAssignmentStatus.arrivedDropoff => 'arrived_dropoff',
    DispatchAssignmentStatus.completed => 'completed',
    DispatchAssignmentStatus.cancelled => 'cancelled',
    DispatchAssignmentStatus.failed => 'failed',
    DispatchAssignmentStatus.unknown => throw StateError('Cannot serialize unknown DispatchAssignmentStatus'),
  };
}

DispatchAssignmentStatus dispatchAssignmentStatusFromWire(String value) => switch (value) {
  'assigned' => DispatchAssignmentStatus.assigned,
  'en_route_pickup' => DispatchAssignmentStatus.enRoutePickup,
  'arrived_pickup' => DispatchAssignmentStatus.arrivedPickup,
  'picked_up' => DispatchAssignmentStatus.pickedUp,
  'en_route_dropoff' => DispatchAssignmentStatus.enRouteDropoff,
  'arrived_dropoff' => DispatchAssignmentStatus.arrivedDropoff,
  'completed' => DispatchAssignmentStatus.completed,
  'cancelled' => DispatchAssignmentStatus.cancelled,
  'failed' => DispatchAssignmentStatus.failed,
  _ => DispatchAssignmentStatus.unknown,
};

class AdvanceAssignmentRequest {
  const AdvanceAssignmentRequest({
    required this.status,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String status;
  final String? reasonCode;
  final int expectedVersion;

  factory AdvanceAssignmentRequest.fromJson(Map<String, Object?> json) => AdvanceAssignmentRequest(
    status: json['status'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class DispatchAssignmentState {
  const DispatchAssignmentState({
    required this.assignmentId,
    required this.status,
    required this.version,
  });

  final UuidV7 assignmentId;
  final DispatchAssignmentStatus status;
  final int version;

  factory DispatchAssignmentState.fromJson(Map<String, Object?> json) => DispatchAssignmentState(
    assignmentId: json['assignment_id'] as String,
    status: dispatchAssignmentStatusFromWire(json['status'] as String),
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'assignment_id': assignmentId,
    'status': status.wireValue,
    'version': version,
  };
}

class DispatchStop {
  const DispatchStop({
    required this.kind,
    required this.sequenceNo,
    required this.latitude,
    required this.longitude,
  });

  final String kind;
  final int sequenceNo;
  final String latitude;
  final String longitude;

  factory DispatchStop.fromJson(Map<String, Object?> json) => DispatchStop(
    kind: json['kind'] as String,
    sequenceNo: (json['sequence_no'] as num).toInt(),
    latitude: json['latitude'] as String,
    longitude: json['longitude'] as String,
  );

  Map<String, Object?> toJson() => {
    'kind': kind,
    'sequence_no': sequenceNo,
    'latitude': latitude,
    'longitude': longitude,
  };
}

class DispatchAssignmentStops {
  const DispatchAssignmentStops({
    required this.assignmentId,
    required this.stops,
  });

  final UuidV7 assignmentId;
  final List<DispatchStop> stops;

  factory DispatchAssignmentStops.fromJson(Map<String, Object?> json) => DispatchAssignmentStops(
    assignmentId: json['assignment_id'] as String,
    stops: (json['stops'] as List).map((e) => DispatchStop.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'assignment_id': assignmentId,
    'stops': stops.map((e) => e.toJson()).toList(),
  };
}

class DispatchAssignmentSummary {
  const DispatchAssignmentSummary({
    required this.assignmentId,
    required this.dispatchJobId,
    required this.status,
    required this.assignedAt,
    required this.completedAt,
    required this.feeSen,
    required this.version,
  });

  final UuidV7 assignmentId;
  final UuidV7 dispatchJobId;
  final DispatchAssignmentStatus status;
  final Timestamp assignedAt;
  final Timestamp? completedAt;
  final int feeSen;
  final int version;

  factory DispatchAssignmentSummary.fromJson(Map<String, Object?> json) => DispatchAssignmentSummary(
    assignmentId: json['assignment_id'] as String,
    dispatchJobId: json['dispatch_job_id'] as String,
    status: dispatchAssignmentStatusFromWire(json['status'] as String),
    assignedAt: json['assigned_at'] as String,
    completedAt: json['completed_at'] == null ? null : json['completed_at'] as String,
    feeSen: (json['fee_sen'] as num).toInt(),
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'assignment_id': assignmentId,
    'dispatch_job_id': dispatchJobId,
    'status': status.wireValue,
    'assigned_at': assignedAt,
    'completed_at': completedAt,
    'fee_sen': feeSen,
    'version': version,
  };
}

class DispatchAssignmentList {
  const DispatchAssignmentList({
    required this.data,
  });

  final List<DispatchAssignmentSummary> data;

  factory DispatchAssignmentList.fromJson(Map<String, Object?> json) => DispatchAssignmentList(
    data: (json['data'] as List).map((e) => DispatchAssignmentSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class RecipientDisclosure {
  const RecipientDisclosure({
    required this.deliveryId,
    required this.recipientName,
    required this.recipientPhoneE164,
    required this.addressLine1,
    required this.addressLine2,
    required this.postcode,
    required this.city,
    required this.stateCode,
  });

  final UuidV7 deliveryId;
  final String recipientName;
  final String recipientPhoneE164;
  final String addressLine1;
  final String? addressLine2;
  final String postcode;
  final String city;
  final String stateCode;

  factory RecipientDisclosure.fromJson(Map<String, Object?> json) => RecipientDisclosure(
    deliveryId: json['delivery_id'] as String,
    recipientName: json['recipient_name'] as String,
    recipientPhoneE164: json['recipient_phone_e164'] as String,
    addressLine1: json['address_line1'] as String,
    addressLine2: json['address_line2'] == null ? null : json['address_line2'] as String,
    postcode: json['postcode'] as String,
    city: json['city'] as String,
    stateCode: json['state_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'delivery_id': deliveryId,
    'recipient_name': recipientName,
    'recipient_phone_e164': recipientPhoneE164,
    'address_line1': addressLine1,
    'address_line2': addressLine2,
    'postcode': postcode,
    'city': city,
    'state_code': stateCode,
  };
}

class RecordWaypointRequest {
  const RecordWaypointRequest({
    required this.latitude,
    required this.longitude,
    required this.accuracyMetres,
    required this.significant,
    required this.recordedAt,
  });

  final double latitude;
  final double longitude;
  final int? accuracyMetres;
  final bool significant;
  final Timestamp recordedAt;

  factory RecordWaypointRequest.fromJson(Map<String, Object?> json) => RecordWaypointRequest(
    latitude: (json['latitude'] as num).toDouble(),
    longitude: (json['longitude'] as num).toDouble(),
    accuracyMetres: json['accuracy_metres'] == null ? null : (json['accuracy_metres'] as num).toInt(),
    significant: json['significant'] as bool,
    recordedAt: json['recorded_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'latitude': latitude,
    'longitude': longitude,
    'accuracy_metres': accuracyMetres,
    'significant': significant,
    'recorded_at': recordedAt,
  };
}

class WaypointOutcome {
  const WaypointOutcome({
    required this.assignmentId,
    required this.outcome,
  });

  final UuidV7 assignmentId;
  final String outcome;

  factory WaypointOutcome.fromJson(Map<String, Object?> json) => WaypointOutcome(
    assignmentId: json['assignment_id'] as String,
    outcome: json['outcome'] as String,
  );

  Map<String, Object?> toJson() => {
    'assignment_id': assignmentId,
    'outcome': outcome,
  };
}

class DriverEarnings {
  const DriverEarnings({
    required this.driverId,
    required this.currency,
    required this.balanceSen,
  });

  final UuidV7 driverId;
  final String currency;
  final int balanceSen;

  factory DriverEarnings.fromJson(Map<String, Object?> json) => DriverEarnings(
    driverId: json['driver_id'] as String,
    currency: json['currency'] as String,
    balanceSen: (json['balance_sen'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'driver_id': driverId,
    'currency': currency,
    'balance_sen': balanceSen,
  };
}

typedef ProfileDetailReasonCode = String;

class PatientAddress {
  const PatientAddress({
    required this.id,
    required this.label,
    required this.line1,
    required this.line2,
    required this.city,
    required this.state,
    required this.postcode,
    required this.countryCode,
    required this.isPrimary,
    required this.latitude,
    required this.longitude,
    required this.version,
  });

  final UuidV7 id;
  final String? label;
  final String line1;
  final String? line2;
  final String city;
  final String state;
  final String postcode;
  final String countryCode;
  final bool isPrimary;
  final String? latitude;
  final String? longitude;
  final int version;

  factory PatientAddress.fromJson(Map<String, Object?> json) => PatientAddress(
    id: json['id'] as String,
    label: json['label'] == null ? null : json['label'] as String,
    line1: json['line1'] as String,
    line2: json['line2'] == null ? null : json['line2'] as String,
    city: json['city'] as String,
    state: json['state'] as String,
    postcode: json['postcode'] as String,
    countryCode: json['country_code'] as String,
    isPrimary: json['is_primary'] as bool,
    latitude: json['latitude'] == null ? null : json['latitude'] as String,
    longitude: json['longitude'] == null ? null : json['longitude'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'label': label,
    'line1': line1,
    'line2': line2,
    'city': city,
    'state': state,
    'postcode': postcode,
    'country_code': countryCode,
    'is_primary': isPrimary,
    'latitude': latitude,
    'longitude': longitude,
    'version': version,
  };
}

class CreatePatientAddressRequest {
  const CreatePatientAddressRequest({
    this.label,
    required this.line1,
    this.line2,
    required this.city,
    required this.state,
    required this.postcode,
    this.countryCode,
    this.isPrimary,
    this.latitude,
    this.longitude,
    required this.reasonCode,
  });

  final String? label;
  final String line1;
  final String? line2;
  final String city;
  final String state;
  final String postcode;
  final String? countryCode;
  final bool? isPrimary;
  final String? latitude;
  final String? longitude;
  final ProfileDetailReasonCode reasonCode;

  factory CreatePatientAddressRequest.fromJson(Map<String, Object?> json) => CreatePatientAddressRequest(
    label: json['label'] == null ? null : json['label'] as String,
    line1: json['line1'] as String,
    line2: json['line2'] == null ? null : json['line2'] as String,
    city: json['city'] as String,
    state: json['state'] as String,
    postcode: json['postcode'] as String,
    countryCode: json['country_code'] == null ? null : json['country_code'] as String,
    isPrimary: json['is_primary'] == null ? null : json['is_primary'] as bool,
    latitude: json['latitude'] == null ? null : json['latitude'] as String,
    longitude: json['longitude'] == null ? null : json['longitude'] as String,
    reasonCode: json['reason_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'label': label,
    'line1': line1,
    'line2': line2,
    'city': city,
    'state': state,
    'postcode': postcode,
    'country_code': countryCode,
    'is_primary': isPrimary,
    'latitude': latitude,
    'longitude': longitude,
    'reason_code': reasonCode,
  };
}

class UpdatePatientAddressRequest {
  const UpdatePatientAddressRequest({
    this.label,
    required this.line1,
    this.line2,
    required this.city,
    required this.state,
    required this.postcode,
    this.countryCode,
    this.isPrimary,
    this.latitude,
    this.longitude,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String? label;
  final String line1;
  final String? line2;
  final String city;
  final String state;
  final String postcode;
  final String? countryCode;
  final bool? isPrimary;
  final String? latitude;
  final String? longitude;
  final ProfileDetailReasonCode reasonCode;
  final int expectedVersion;

  factory UpdatePatientAddressRequest.fromJson(Map<String, Object?> json) => UpdatePatientAddressRequest(
    label: json['label'] == null ? null : json['label'] as String,
    line1: json['line1'] as String,
    line2: json['line2'] == null ? null : json['line2'] as String,
    city: json['city'] as String,
    state: json['state'] as String,
    postcode: json['postcode'] as String,
    countryCode: json['country_code'] == null ? null : json['country_code'] as String,
    isPrimary: json['is_primary'] == null ? null : json['is_primary'] as bool,
    latitude: json['latitude'] == null ? null : json['latitude'] as String,
    longitude: json['longitude'] == null ? null : json['longitude'] as String,
    reasonCode: json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'label': label,
    'line1': line1,
    'line2': line2,
    'city': city,
    'state': state,
    'postcode': postcode,
    'country_code': countryCode,
    'is_primary': isPrimary,
    'latitude': latitude,
    'longitude': longitude,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class EmergencyContact {
  const EmergencyContact({
    required this.id,
    required this.name,
    required this.relationship,
    required this.phoneE164,
    required this.isPrimary,
    required this.version,
  });

  final UuidV7 id;
  final String name;
  final String relationship;
  final String phoneE164;
  final bool isPrimary;
  final int version;

  factory EmergencyContact.fromJson(Map<String, Object?> json) => EmergencyContact(
    id: json['id'] as String,
    name: json['name'] as String,
    relationship: json['relationship'] as String,
    phoneE164: json['phone_e164'] as String,
    isPrimary: json['is_primary'] as bool,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'relationship': relationship,
    'phone_e164': phoneE164,
    'is_primary': isPrimary,
    'version': version,
  };
}

class CreateEmergencyContactRequest {
  const CreateEmergencyContactRequest({
    required this.name,
    required this.relationship,
    required this.phoneE164,
    this.isPrimary,
    required this.reasonCode,
  });

  final String name;
  final String relationship;
  final String phoneE164;
  final bool? isPrimary;
  final ProfileDetailReasonCode reasonCode;

  factory CreateEmergencyContactRequest.fromJson(Map<String, Object?> json) => CreateEmergencyContactRequest(
    name: json['name'] as String,
    relationship: json['relationship'] as String,
    phoneE164: json['phone_e164'] as String,
    isPrimary: json['is_primary'] == null ? null : json['is_primary'] as bool,
    reasonCode: json['reason_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'name': name,
    'relationship': relationship,
    'phone_e164': phoneE164,
    'is_primary': isPrimary,
    'reason_code': reasonCode,
  };
}

class UpdateEmergencyContactRequest {
  const UpdateEmergencyContactRequest({
    required this.name,
    required this.relationship,
    required this.phoneE164,
    this.isPrimary,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String name;
  final String relationship;
  final String phoneE164;
  final bool? isPrimary;
  final ProfileDetailReasonCode reasonCode;
  final int expectedVersion;

  factory UpdateEmergencyContactRequest.fromJson(Map<String, Object?> json) => UpdateEmergencyContactRequest(
    name: json['name'] as String,
    relationship: json['relationship'] as String,
    phoneE164: json['phone_e164'] as String,
    isPrimary: json['is_primary'] == null ? null : json['is_primary'] as bool,
    reasonCode: json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'name': name,
    'relationship': relationship,
    'phone_e164': phoneE164,
    'is_primary': isPrimary,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class PatientAllergy {
  const PatientAllergy({
    required this.id,
    required this.substance,
    required this.reaction,
    required this.severity,
    required this.recordedAt,
    required this.version,
  });

  final UuidV7 id;
  final String substance;
  final String? reaction;
  final String severity;
  final Timestamp recordedAt;
  final int version;

  factory PatientAllergy.fromJson(Map<String, Object?> json) => PatientAllergy(
    id: json['id'] as String,
    substance: json['substance'] as String,
    reaction: json['reaction'] == null ? null : json['reaction'] as String,
    severity: json['severity'] as String,
    recordedAt: json['recorded_at'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'substance': substance,
    'reaction': reaction,
    'severity': severity,
    'recorded_at': recordedAt,
    'version': version,
  };
}

class CreatePatientAllergyRequest {
  const CreatePatientAllergyRequest({
    required this.substance,
    this.reaction,
    required this.severity,
    this.recordedAt,
    required this.reasonCode,
  });

  final String substance;
  final String? reaction;
  final String severity;
  final Timestamp? recordedAt;
  final ProfileDetailReasonCode reasonCode;

  factory CreatePatientAllergyRequest.fromJson(Map<String, Object?> json) => CreatePatientAllergyRequest(
    substance: json['substance'] as String,
    reaction: json['reaction'] == null ? null : json['reaction'] as String,
    severity: json['severity'] as String,
    recordedAt: json['recorded_at'] == null ? null : json['recorded_at'] as String,
    reasonCode: json['reason_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'substance': substance,
    'reaction': reaction,
    'severity': severity,
    'recorded_at': recordedAt,
    'reason_code': reasonCode,
  };
}

class UpdatePatientAllergyRequest {
  const UpdatePatientAllergyRequest({
    required this.substance,
    this.reaction,
    required this.severity,
    this.recordedAt,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String substance;
  final String? reaction;
  final String severity;
  final Timestamp? recordedAt;
  final ProfileDetailReasonCode reasonCode;
  final int expectedVersion;

  factory UpdatePatientAllergyRequest.fromJson(Map<String, Object?> json) => UpdatePatientAllergyRequest(
    substance: json['substance'] as String,
    reaction: json['reaction'] == null ? null : json['reaction'] as String,
    severity: json['severity'] as String,
    recordedAt: json['recorded_at'] == null ? null : json['recorded_at'] as String,
    reasonCode: json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'substance': substance,
    'reaction': reaction,
    'severity': severity,
    'recorded_at': recordedAt,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class PatientCondition {
  const PatientCondition({
    required this.id,
    required this.conditionName,
    required this.status,
    required this.onsetDate,
    required this.resolvedDate,
    required this.notes,
    required this.version,
  });

  final UuidV7 id;
  final String conditionName;
  final String status;
  final String? onsetDate;
  final String? resolvedDate;
  final String? notes;
  final int version;

  factory PatientCondition.fromJson(Map<String, Object?> json) => PatientCondition(
    id: json['id'] as String,
    conditionName: json['condition_name'] as String,
    status: json['status'] as String,
    onsetDate: json['onset_date'] == null ? null : json['onset_date'] as String,
    resolvedDate: json['resolved_date'] == null ? null : json['resolved_date'] as String,
    notes: json['notes'] == null ? null : json['notes'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'condition_name': conditionName,
    'status': status,
    'onset_date': onsetDate,
    'resolved_date': resolvedDate,
    'notes': notes,
    'version': version,
  };
}

class CreatePatientConditionRequest {
  const CreatePatientConditionRequest({
    required this.conditionName,
    required this.status,
    this.onsetDate,
    this.resolvedDate,
    this.notes,
    required this.reasonCode,
  });

  final String conditionName;
  final String status;
  final String? onsetDate;
  final String? resolvedDate;
  final String? notes;
  final ProfileDetailReasonCode reasonCode;

  factory CreatePatientConditionRequest.fromJson(Map<String, Object?> json) => CreatePatientConditionRequest(
    conditionName: json['condition_name'] as String,
    status: json['status'] as String,
    onsetDate: json['onset_date'] == null ? null : json['onset_date'] as String,
    resolvedDate: json['resolved_date'] == null ? null : json['resolved_date'] as String,
    notes: json['notes'] == null ? null : json['notes'] as String,
    reasonCode: json['reason_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'condition_name': conditionName,
    'status': status,
    'onset_date': onsetDate,
    'resolved_date': resolvedDate,
    'notes': notes,
    'reason_code': reasonCode,
  };
}

class UpdatePatientConditionRequest {
  const UpdatePatientConditionRequest({
    required this.conditionName,
    required this.status,
    this.onsetDate,
    this.resolvedDate,
    this.notes,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String conditionName;
  final String status;
  final String? onsetDate;
  final String? resolvedDate;
  final String? notes;
  final ProfileDetailReasonCode reasonCode;
  final int expectedVersion;

  factory UpdatePatientConditionRequest.fromJson(Map<String, Object?> json) => UpdatePatientConditionRequest(
    conditionName: json['condition_name'] as String,
    status: json['status'] as String,
    onsetDate: json['onset_date'] == null ? null : json['onset_date'] as String,
    resolvedDate: json['resolved_date'] == null ? null : json['resolved_date'] as String,
    notes: json['notes'] == null ? null : json['notes'] as String,
    reasonCode: json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'condition_name': conditionName,
    'status': status,
    'onset_date': onsetDate,
    'resolved_date': resolvedDate,
    'notes': notes,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class DoctorProfessionalDetail {
  const DoctorProfessionalDetail({
    required this.membershipId,
    required this.biography,
    required this.yearsExperience,
    required this.consultationFeeSen,
    required this.currency,
    required this.acceptsNewPatients,
    required this.specialties,
    required this.languages,
    required this.version,
  });

  final UuidV7 membershipId;
  final String? biography;
  final int? yearsExperience;
  final int consultationFeeSen;
  final String currency;
  final bool acceptsNewPatients;
  final List<String> specialties;
  final List<String> languages;
  final int version;

  factory DoctorProfessionalDetail.fromJson(Map<String, Object?> json) => DoctorProfessionalDetail(
    membershipId: json['membership_id'] as String,
    biography: json['biography'] == null ? null : json['biography'] as String,
    yearsExperience: json['years_experience'] == null ? null : (json['years_experience'] as num).toInt(),
    consultationFeeSen: (json['consultation_fee_sen'] as num).toInt(),
    currency: json['currency'] as String,
    acceptsNewPatients: json['accepts_new_patients'] as bool,
    specialties: List<String>.from(json['specialties'] as List),
    languages: List<String>.from(json['languages'] as List),
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'membership_id': membershipId,
    'biography': biography,
    'years_experience': yearsExperience,
    'consultation_fee_sen': consultationFeeSen,
    'currency': currency,
    'accepts_new_patients': acceptsNewPatients,
    'specialties': specialties,
    'languages': languages,
    'version': version,
  };
}

class PatientAddressList {
  const PatientAddressList({
    required this.data,
  });

  final List<PatientAddress> data;

  factory PatientAddressList.fromJson(Map<String, Object?> json) => PatientAddressList(
    data: (json['data'] as List).map((e) => PatientAddress.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class EmergencyContactList {
  const EmergencyContactList({
    required this.data,
  });

  final List<EmergencyContact> data;

  factory EmergencyContactList.fromJson(Map<String, Object?> json) => EmergencyContactList(
    data: (json['data'] as List).map((e) => EmergencyContact.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class PatientAllergyList {
  const PatientAllergyList({
    required this.data,
  });

  final List<PatientAllergy> data;

  factory PatientAllergyList.fromJson(Map<String, Object?> json) => PatientAllergyList(
    data: (json['data'] as List).map((e) => PatientAllergy.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class PatientConditionList {
  const PatientConditionList({
    required this.data,
  });

  final List<PatientCondition> data;

  factory PatientConditionList.fromJson(Map<String, Object?> json) => PatientConditionList(
    data: (json['data'] as List).map((e) => PatientCondition.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

enum EmergencyEventStatus {
  created,
  triaged,
  dispatching,
  unitAssigned,
  responding,
  onScene,
  transporting,
  resolved,
  cancelled,
  falseAlarm,
  unknown,
}

extension EmergencyEventStatusWire on EmergencyEventStatus {
  String get wireValue => switch (this) {
    EmergencyEventStatus.created => 'created',
    EmergencyEventStatus.triaged => 'triaged',
    EmergencyEventStatus.dispatching => 'dispatching',
    EmergencyEventStatus.unitAssigned => 'unit_assigned',
    EmergencyEventStatus.responding => 'responding',
    EmergencyEventStatus.onScene => 'on_scene',
    EmergencyEventStatus.transporting => 'transporting',
    EmergencyEventStatus.resolved => 'resolved',
    EmergencyEventStatus.cancelled => 'cancelled',
    EmergencyEventStatus.falseAlarm => 'false_alarm',
    EmergencyEventStatus.unknown => throw StateError('Cannot serialize unknown EmergencyEventStatus'),
  };
}

EmergencyEventStatus emergencyEventStatusFromWire(String value) => switch (value) {
  'created' => EmergencyEventStatus.created,
  'triaged' => EmergencyEventStatus.triaged,
  'dispatching' => EmergencyEventStatus.dispatching,
  'unit_assigned' => EmergencyEventStatus.unitAssigned,
  'responding' => EmergencyEventStatus.responding,
  'on_scene' => EmergencyEventStatus.onScene,
  'transporting' => EmergencyEventStatus.transporting,
  'resolved' => EmergencyEventStatus.resolved,
  'cancelled' => EmergencyEventStatus.cancelled,
  'false_alarm' => EmergencyEventStatus.falseAlarm,
  _ => EmergencyEventStatus.unknown,
};

enum TriagePriority {
  unknown,
  low,
  medium,
  high,
  critical,
}

extension TriagePriorityWire on TriagePriority {
  String get wireValue => switch (this) {
    TriagePriority.unknown => 'unknown',
    TriagePriority.low => 'low',
    TriagePriority.medium => 'medium',
    TriagePriority.high => 'high',
    TriagePriority.critical => 'critical',
  };
}

TriagePriority triagePriorityFromWire(String value) => switch (value) {
  'unknown' => TriagePriority.unknown,
  'low' => TriagePriority.low,
  'medium' => TriagePriority.medium,
  'high' => TriagePriority.high,
  'critical' => TriagePriority.critical,
  _ => TriagePriority.unknown,
};

class EmergencyVitalSnapshot {
  const EmergencyVitalSnapshot({
    required this.metric,
    required this.value,
    required this.unit,
    required this.quality,
    required this.measuredAt,
  });

  final String metric;
  final String value;
  final String unit;
  final String quality;
  final Timestamp measuredAt;

  factory EmergencyVitalSnapshot.fromJson(Map<String, Object?> json) => EmergencyVitalSnapshot(
    metric: json['metric'] as String,
    value: json['value'] as String,
    unit: json['unit'] as String,
    quality: json['quality'] as String,
    measuredAt: json['measured_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'metric': metric,
    'value': value,
    'unit': unit,
    'quality': quality,
    'measured_at': measuredAt,
  };
}

class RaiseEmergencyRequest {
  const RaiseEmergencyRequest({
    required this.organizationId,
    this.siteId,
    this.patientProfileId,
    required this.categoryCode,
    this.latitude,
    this.longitude,
    this.addressText,
    this.vitals,
  });

  final UuidV7 organizationId;
  final UuidV7? siteId;
  final UuidV7? patientProfileId;
  final String categoryCode;
  final String? latitude;
  final String? longitude;
  final String? addressText;
  final List<EmergencyVitalSnapshot>? vitals;

  factory RaiseEmergencyRequest.fromJson(Map<String, Object?> json) => RaiseEmergencyRequest(
    organizationId: json['organization_id'] as String,
    siteId: json['site_id'] == null ? null : json['site_id'] as String,
    patientProfileId: json['patient_profile_id'] == null ? null : json['patient_profile_id'] as String,
    categoryCode: json['category_code'] as String,
    latitude: json['latitude'] == null ? null : json['latitude'] as String,
    longitude: json['longitude'] == null ? null : json['longitude'] as String,
    addressText: json['address_text'] == null ? null : json['address_text'] as String,
    vitals: json['vitals'] == null ? null : (json['vitals'] as List).map((e) => EmergencyVitalSnapshot.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'organization_id': organizationId,
    'site_id': siteId,
    'patient_profile_id': patientProfileId,
    'category_code': categoryCode,
    'latitude': latitude,
    'longitude': longitude,
    'address_text': addressText,
    'vitals': vitals?.map((e) => e.toJson()).toList(),
  };
}

class EmergencyEventCreated {
  const EmergencyEventCreated({
    required this.emergencyEventId,
    required this.status,
    required this.triagePriority,
    required this.version,
  });

  final UuidV7 emergencyEventId;
  final EmergencyEventStatus status;
  final TriagePriority triagePriority;
  final int version;

  factory EmergencyEventCreated.fromJson(Map<String, Object?> json) => EmergencyEventCreated(
    emergencyEventId: json['emergency_event_id'] as String,
    status: emergencyEventStatusFromWire(json['status'] as String),
    triagePriority: triagePriorityFromWire(json['triage_priority'] as String),
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'emergency_event_id': emergencyEventId,
    'status': status.wireValue,
    'triage_priority': triagePriority.wireValue,
    'version': version,
  };
}

class EmergencyEventView {
  const EmergencyEventView({
    required this.emergencyEventId,
    required this.status,
    required this.triagePriority,
    required this.categoryCode,
    required this.version,
  });

  final UuidV7 emergencyEventId;
  final EmergencyEventStatus status;
  final TriagePriority triagePriority;
  final String categoryCode;
  final int version;

  factory EmergencyEventView.fromJson(Map<String, Object?> json) => EmergencyEventView(
    emergencyEventId: json['emergency_event_id'] as String,
    status: emergencyEventStatusFromWire(json['status'] as String),
    triagePriority: triagePriorityFromWire(json['triage_priority'] as String),
    categoryCode: json['category_code'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'emergency_event_id': emergencyEventId,
    'status': status.wireValue,
    'triage_priority': triagePriority.wireValue,
    'category_code': categoryCode,
    'version': version,
  };
}

class RecordTriageRequest {
  const RecordTriageRequest({
    required this.priority,
    required this.protocolCode,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final String priority;
  final String protocolCode;
  final String reasonCode;
  final int expectedVersion;

  factory RecordTriageRequest.fromJson(Map<String, Object?> json) => RecordTriageRequest(
    priority: json['priority'] as String,
    protocolCode: json['protocol_code'] as String,
    reasonCode: json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'priority': priority,
    'protocol_code': protocolCode,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class TriageRecorded {
  const TriageRecorded({
    required this.emergencyEventId,
    required this.status,
    required this.triagePriority,
  });

  final UuidV7 emergencyEventId;
  final EmergencyEventStatus status;
  final TriagePriority triagePriority;

  factory TriageRecorded.fromJson(Map<String, Object?> json) => TriageRecorded(
    emergencyEventId: json['emergency_event_id'] as String,
    status: emergencyEventStatusFromWire(json['status'] as String),
    triagePriority: triagePriorityFromWire(json['triage_priority'] as String),
  );

  Map<String, Object?> toJson() => {
    'emergency_event_id': emergencyEventId,
    'status': status.wireValue,
    'triage_priority': triagePriority.wireValue,
  };
}

class ReserveUnitRequest {
  const ReserveUnitRequest({
    required this.emergencyUnitId,
    this.manualOverride,
    this.overrideReasonCode,
    required this.expectedVersion,
  });

  final UuidV7 emergencyUnitId;
  final bool? manualOverride;
  final String? overrideReasonCode;
  final int expectedVersion;

  factory ReserveUnitRequest.fromJson(Map<String, Object?> json) => ReserveUnitRequest(
    emergencyUnitId: json['emergency_unit_id'] as String,
    manualOverride: json['manual_override'] == null ? null : json['manual_override'] as bool,
    overrideReasonCode: json['override_reason_code'] == null ? null : json['override_reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'emergency_unit_id': emergencyUnitId,
    'manual_override': manualOverride,
    'override_reason_code': overrideReasonCode,
    'expected_version': expectedVersion,
  };
}

class EmergencyDispatchCreated {
  const EmergencyDispatchCreated({
    required this.emergencyDispatchId,
    required this.emergencyEventId,
    required this.status,
  });

  final UuidV7 emergencyDispatchId;
  final UuidV7 emergencyEventId;
  final String status;

  factory EmergencyDispatchCreated.fromJson(Map<String, Object?> json) => EmergencyDispatchCreated(
    emergencyDispatchId: json['emergency_dispatch_id'] as String,
    emergencyEventId: json['emergency_event_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'emergency_dispatch_id': emergencyDispatchId,
    'emergency_event_id': emergencyEventId,
    'status': status,
  };
}

class AdvanceEmergencyRequest {
  const AdvanceEmergencyRequest({
    required this.status,
    this.reasonCode,
    required this.expectedVersion,
  });

  final String status;
  final String? reasonCode;
  final int expectedVersion;

  factory AdvanceEmergencyRequest.fromJson(Map<String, Object?> json) => AdvanceEmergencyRequest(
    status: json['status'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class EmergencyEventState {
  const EmergencyEventState({
    required this.emergencyEventId,
    required this.status,
  });

  final UuidV7 emergencyEventId;
  final EmergencyEventStatus status;

  factory EmergencyEventState.fromJson(Map<String, Object?> json) => EmergencyEventState(
    emergencyEventId: json['emergency_event_id'] as String,
    status: emergencyEventStatusFromWire(json['status'] as String),
  );

  Map<String, Object?> toJson() => {
    'emergency_event_id': emergencyEventId,
    'status': status.wireValue,
  };
}

class ResolveEmergencyRequest {
  const ResolveEmergencyRequest({
    required this.resolutionType,
    required this.notes,
    this.outcomeCode,
    required this.expectedVersion,
  });

  final String resolutionType;
  final String notes;
  final String? outcomeCode;
  final int expectedVersion;

  factory ResolveEmergencyRequest.fromJson(Map<String, Object?> json) => ResolveEmergencyRequest(
    resolutionType: json['resolution_type'] as String,
    notes: json['notes'] as String,
    outcomeCode: json['outcome_code'] == null ? null : json['outcome_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'resolution_type': resolutionType,
    'notes': notes,
    'outcome_code': outcomeCode,
    'expected_version': expectedVersion,
  };
}

class EmergencyResolution {
  const EmergencyResolution({
    required this.emergencyEventId,
    required this.resolutionType,
    required this.responseDurationSeconds,
  });

  final UuidV7 emergencyEventId;
  final String resolutionType;
  final int responseDurationSeconds;

  factory EmergencyResolution.fromJson(Map<String, Object?> json) => EmergencyResolution(
    emergencyEventId: json['emergency_event_id'] as String,
    resolutionType: json['resolution_type'] as String,
    responseDurationSeconds: (json['response_duration_seconds'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'emergency_event_id': emergencyEventId,
    'resolution_type': resolutionType,
    'response_duration_seconds': responseDurationSeconds,
  };
}

class RecordCommunicationRequest {
  const RecordCommunicationRequest({
    required this.channel,
    required this.direction,
    required this.summaryCode,
  });

  final String channel;
  final String direction;
  final String summaryCode;

  factory RecordCommunicationRequest.fromJson(Map<String, Object?> json) => RecordCommunicationRequest(
    channel: json['channel'] as String,
    direction: json['direction'] as String,
    summaryCode: json['summary_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'channel': channel,
    'direction': direction,
    'summary_code': summaryCode,
  };
}

class CommunicationRecorded {
  const CommunicationRecorded({
    required this.emergencyEventId,
    required this.recorded,
  });

  final UuidV7 emergencyEventId;
  final String recorded;

  factory CommunicationRecorded.fromJson(Map<String, Object?> json) => CommunicationRecorded(
    emergencyEventId: json['emergency_event_id'] as String,
    recorded: json['recorded'] as String,
  );

  Map<String, Object?> toJson() => {
    'emergency_event_id': emergencyEventId,
    'recorded': recorded,
  };
}

class ActivateBreakGlassRequest {
  const ActivateBreakGlassRequest({
    required this.emergencyEventId,
    required this.reasonCode,
    this.reasonDetail,
    this.renewsGrantId,
    this.grantMinutes,
  });

  final UuidV7 emergencyEventId;
  final String reasonCode;
  final String? reasonDetail;
  final UuidV7? renewsGrantId;
  final int? grantMinutes;

  factory ActivateBreakGlassRequest.fromJson(Map<String, Object?> json) => ActivateBreakGlassRequest(
    emergencyEventId: json['emergency_event_id'] as String,
    reasonCode: json['reason_code'] as String,
    reasonDetail: json['reason_detail'] == null ? null : json['reason_detail'] as String,
    renewsGrantId: json['renews_grant_id'] == null ? null : json['renews_grant_id'] as String,
    grantMinutes: json['grant_minutes'] == null ? null : (json['grant_minutes'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'emergency_event_id': emergencyEventId,
    'reason_code': reasonCode,
    'reason_detail': reasonDetail,
    'renews_grant_id': renewsGrantId,
    'grant_minutes': grantMinutes,
  };
}

class BreakGlassGrant {
  const BreakGlassGrant({
    required this.breakGlassGrantId,
    required this.patientProfileId,
    required this.expiresAt,
  });

  final UuidV7 breakGlassGrantId;
  final UuidV7 patientProfileId;
  final Timestamp expiresAt;

  factory BreakGlassGrant.fromJson(Map<String, Object?> json) => BreakGlassGrant(
    breakGlassGrantId: json['break_glass_grant_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    expiresAt: json['expires_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'break_glass_grant_id': breakGlassGrantId,
    'patient_profile_id': patientProfileId,
    'expires_at': expiresAt,
  };
}

class BreakGlassDisclosure {
  const BreakGlassDisclosure({
    required this.breakGlassGrantId,
    required this.patientProfileId,
    required this.displayName,
    required this.allergies,
    required this.activeConditions,
  });

  final UuidV7 breakGlassGrantId;
  final UuidV7 patientProfileId;
  final String displayName;
  final List<Map<String, Object?>> allergies;
  final List<Map<String, Object?>> activeConditions;

  factory BreakGlassDisclosure.fromJson(Map<String, Object?> json) => BreakGlassDisclosure(
    breakGlassGrantId: json['break_glass_grant_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    displayName: json['display_name'] as String,
    allergies: List<Map<String, Object?>>.from(json['allergies'] as List),
    activeConditions: List<Map<String, Object?>>.from(json['active_conditions'] as List),
  );

  Map<String, Object?> toJson() => {
    'break_glass_grant_id': breakGlassGrantId,
    'patient_profile_id': patientProfileId,
    'display_name': displayName,
    'allergies': allergies,
    'active_conditions': activeConditions,
  };
}

class TerminateBreakGlassRequest {
  const TerminateBreakGlassRequest({
    required this.reasonCode,
  });

  final String reasonCode;

  factory TerminateBreakGlassRequest.fromJson(Map<String, Object?> json) => TerminateBreakGlassRequest(
    reasonCode: json['reason_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'reason_code': reasonCode,
  };
}

class BreakGlassTerminated {
  const BreakGlassTerminated({
    required this.breakGlassGrantId,
    required this.status,
  });

  final UuidV7 breakGlassGrantId;
  final String status;

  factory BreakGlassTerminated.fromJson(Map<String, Object?> json) => BreakGlassTerminated(
    breakGlassGrantId: json['break_glass_grant_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'break_glass_grant_id': breakGlassGrantId,
    'status': status,
  };
}

class ReviewBreakGlassRequest {
  const ReviewBreakGlassRequest({
    required this.outcome,
    required this.notes,
  });

  final String outcome;
  final String notes;

  factory ReviewBreakGlassRequest.fromJson(Map<String, Object?> json) => ReviewBreakGlassRequest(
    outcome: json['outcome'] as String,
    notes: json['notes'] as String,
  );

  Map<String, Object?> toJson() => {
    'outcome': outcome,
    'notes': notes,
  };
}

class BreakGlassReviewed {
  const BreakGlassReviewed({
    required this.breakGlassGrantId,
    required this.outcome,
  });

  final UuidV7 breakGlassGrantId;
  final String outcome;

  factory BreakGlassReviewed.fromJson(Map<String, Object?> json) => BreakGlassReviewed(
    breakGlassGrantId: json['break_glass_grant_id'] as String,
    outcome: json['outcome'] as String,
  );

  Map<String, Object?> toJson() => {
    'break_glass_grant_id': breakGlassGrantId,
    'outcome': outcome,
  };
}

class LedgerAccountBalance {
  const LedgerAccountBalance({
    required this.ledgerAccountId,
    required this.accountCode,
    required this.kind,
    required this.normalSide,
    required this.balanceSen,
  });

  final UuidV7 ledgerAccountId;
  final String accountCode;
  final String kind;
  final String normalSide;
  final int balanceSen;

  factory LedgerAccountBalance.fromJson(Map<String, Object?> json) => LedgerAccountBalance(
    ledgerAccountId: json['ledger_account_id'] as String,
    accountCode: json['account_code'] as String,
    kind: json['kind'] as String,
    normalSide: json['normal_side'] as String,
    balanceSen: (json['balance_sen'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'ledger_account_id': ledgerAccountId,
    'account_code': accountCode,
    'kind': kind,
    'normal_side': normalSide,
    'balance_sen': balanceSen,
  };
}

class LedgerAccountBalanceList {
  const LedgerAccountBalanceList({
    required this.organizationId,
    required this.currency,
    required this.data,
  });

  final UuidV7 organizationId;
  final String currency;
  final List<LedgerAccountBalance> data;

  factory LedgerAccountBalanceList.fromJson(Map<String, Object?> json) => LedgerAccountBalanceList(
    organizationId: json['organization_id'] as String,
    currency: json['currency'] as String,
    data: (json['data'] as List).map((e) => LedgerAccountBalance.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'organization_id': organizationId,
    'currency': currency,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class ReverseLedgerEntryRequest {
  const ReverseLedgerEntryRequest({
    required this.memoCode,
  });

  final String memoCode;

  factory ReverseLedgerEntryRequest.fromJson(Map<String, Object?> json) => ReverseLedgerEntryRequest(
    memoCode: json['memo_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'memo_code': memoCode,
  };
}

class LedgerReversal {
  const LedgerReversal({
    required this.ledgerEntryId,
    required this.reversesEntryId,
  });

  final UuidV7 ledgerEntryId;
  final UuidV7 reversesEntryId;

  factory LedgerReversal.fromJson(Map<String, Object?> json) => LedgerReversal(
    ledgerEntryId: json['ledger_entry_id'] as String,
    reversesEntryId: json['reverses_entry_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'ledger_entry_id': ledgerEntryId,
    'reverses_entry_id': reversesEntryId,
  };
}

class CreatePayoutRunRequest {
  const CreatePayoutRunRequest({
    required this.periodStart,
    required this.periodEnd,
  });

  final String periodStart;
  final String periodEnd;

  factory CreatePayoutRunRequest.fromJson(Map<String, Object?> json) => CreatePayoutRunRequest(
    periodStart: json['period_start'] as String,
    periodEnd: json['period_end'] as String,
  );

  Map<String, Object?> toJson() => {
    'period_start': periodStart,
    'period_end': periodEnd,
  };
}

class PayoutRunCreated {
  const PayoutRunCreated({
    required this.payoutRunId,
    required this.status,
  });

  final UuidV7 payoutRunId;
  final String status;

  factory PayoutRunCreated.fromJson(Map<String, Object?> json) => PayoutRunCreated(
    payoutRunId: json['payout_run_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'payout_run_id': payoutRunId,
    'status': status,
  };
}

class AddPayoutItemRequest {
  const AddPayoutItemRequest({
    required this.payeeMembershipId,
    required this.grossSen,
    required this.platformFeeSen,
  });

  final UuidV7 payeeMembershipId;
  final int grossSen;
  final int platformFeeSen;

  factory AddPayoutItemRequest.fromJson(Map<String, Object?> json) => AddPayoutItemRequest(
    payeeMembershipId: json['payee_membership_id'] as String,
    grossSen: (json['gross_sen'] as num).toInt(),
    platformFeeSen: (json['platform_fee_sen'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'payee_membership_id': payeeMembershipId,
    'gross_sen': grossSen,
    'platform_fee_sen': platformFeeSen,
  };
}

class PayoutItemCreated {
  const PayoutItemCreated({
    required this.payoutItemId,
    required this.netSen,
    required this.status,
  });

  final UuidV7 payoutItemId;
  final int netSen;
  final String status;

  factory PayoutItemCreated.fromJson(Map<String, Object?> json) => PayoutItemCreated(
    payoutItemId: json['payout_item_id'] as String,
    netSen: (json['net_sen'] as num).toInt(),
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'payout_item_id': payoutItemId,
    'net_sen': netSen,
    'status': status,
  };
}

class AdvancePayoutRunRequest {
  const AdvancePayoutRunRequest({
    required this.status,
    this.reasonCode,
    required this.expectedVersion,
  });

  final String status;
  final String? reasonCode;
  final int expectedVersion;

  factory AdvancePayoutRunRequest.fromJson(Map<String, Object?> json) => AdvancePayoutRunRequest(
    status: json['status'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class PayoutRunState {
  const PayoutRunState({
    required this.payoutRunId,
    required this.status,
  });

  final UuidV7 payoutRunId;
  final String status;

  factory PayoutRunState.fromJson(Map<String, Object?> json) => PayoutRunState(
    payoutRunId: json['payout_run_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'payout_run_id': payoutRunId,
    'status': status,
  };
}

class SettlePayoutItemRequest {
  const SettlePayoutItemRequest({
    required this.payableAccountId,
    required this.cashAccountId,
  });

  final UuidV7 payableAccountId;
  final UuidV7 cashAccountId;

  factory SettlePayoutItemRequest.fromJson(Map<String, Object?> json) => SettlePayoutItemRequest(
    payableAccountId: json['payable_account_id'] as String,
    cashAccountId: json['cash_account_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'payable_account_id': payableAccountId,
    'cash_account_id': cashAccountId,
  };
}

class PayoutItemSettled {
  const PayoutItemSettled({
    required this.payoutItemId,
    required this.status,
    required this.ledgerEntryId,
  });

  final UuidV7 payoutItemId;
  final String status;
  final UuidV7 ledgerEntryId;

  factory PayoutItemSettled.fromJson(Map<String, Object?> json) => PayoutItemSettled(
    payoutItemId: json['payout_item_id'] as String,
    status: json['status'] as String,
    ledgerEntryId: json['ledger_entry_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'payout_item_id': payoutItemId,
    'status': status,
    'ledger_entry_id': ledgerEntryId,
  };
}

class CreateSupportTicketRequest {
  const CreateSupportTicketRequest({
    required this.organizationId,
    required this.categoryCode,
    required this.subjectCode,
    this.priority,
    required this.body,
  });

  final UuidV7 organizationId;
  final String categoryCode;
  final String subjectCode;
  final String? priority;
  final String body;

  factory CreateSupportTicketRequest.fromJson(Map<String, Object?> json) => CreateSupportTicketRequest(
    organizationId: json['organization_id'] as String,
    categoryCode: json['category_code'] as String,
    subjectCode: json['subject_code'] as String,
    priority: json['priority'] == null ? null : json['priority'] as String,
    body: json['body'] as String,
  );

  Map<String, Object?> toJson() => {
    'organization_id': organizationId,
    'category_code': categoryCode,
    'subject_code': subjectCode,
    'priority': priority,
    'body': body,
  };
}

class SupportTicketCreated {
  const SupportTicketCreated({
    required this.supportTicketId,
    required this.status,
  });

  final UuidV7 supportTicketId;
  final String status;

  factory SupportTicketCreated.fromJson(Map<String, Object?> json) => SupportTicketCreated(
    supportTicketId: json['support_ticket_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'support_ticket_id': supportTicketId,
    'status': status,
  };
}

class SupportTicketMessage {
  const SupportTicketMessage({
    required this.authorProfileId,
    required this.body,
    required this.internalOnly,
    required this.createdAt,
  });

  final UuidV7 authorProfileId;
  final String body;
  final bool internalOnly;
  final Timestamp createdAt;

  factory SupportTicketMessage.fromJson(Map<String, Object?> json) => SupportTicketMessage(
    authorProfileId: json['author_profile_id'] as String,
    body: json['body'] as String,
    internalOnly: json['internal_only'] as bool,
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'author_profile_id': authorProfileId,
    'body': body,
    'internal_only': internalOnly,
    'created_at': createdAt,
  };
}

class SupportTicketThread {
  const SupportTicketThread({
    required this.supportTicketId,
    required this.status,
    required this.version,
    required this.messages,
  });

  final UuidV7 supportTicketId;
  final String status;
  final int version;
  final List<SupportTicketMessage> messages;

  factory SupportTicketThread.fromJson(Map<String, Object?> json) => SupportTicketThread(
    supportTicketId: json['support_ticket_id'] as String,
    status: json['status'] as String,
    version: (json['version'] as num).toInt(),
    messages: (json['messages'] as List).map((e) => SupportTicketMessage.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'support_ticket_id': supportTicketId,
    'status': status,
    'version': version,
    'messages': messages.map((e) => e.toJson()).toList(),
  };
}

class AddSupportTicketMessageRequest {
  const AddSupportTicketMessageRequest({
    required this.body,
    this.internalOnly,
  });

  final String body;
  final bool? internalOnly;

  factory AddSupportTicketMessageRequest.fromJson(Map<String, Object?> json) => AddSupportTicketMessageRequest(
    body: json['body'] as String,
    internalOnly: json['internal_only'] == null ? null : json['internal_only'] as bool,
  );

  Map<String, Object?> toJson() => {
    'body': body,
    'internal_only': internalOnly,
  };
}

class SupportTicketMessageRecorded {
  const SupportTicketMessageRecorded({
    required this.supportTicketId,
    required this.recorded,
  });

  final UuidV7 supportTicketId;
  final String recorded;

  factory SupportTicketMessageRecorded.fromJson(Map<String, Object?> json) => SupportTicketMessageRecorded(
    supportTicketId: json['support_ticket_id'] as String,
    recorded: json['recorded'] as String,
  );

  Map<String, Object?> toJson() => {
    'support_ticket_id': supportTicketId,
    'recorded': recorded,
  };
}

class AssignSupportTicketRequest {
  const AssignSupportTicketRequest({
    required this.assignedMembershipId,
    required this.reasonCode,
    required this.expectedVersion,
  });

  final UuidV7 assignedMembershipId;
  final String reasonCode;
  final int expectedVersion;

  factory AssignSupportTicketRequest.fromJson(Map<String, Object?> json) => AssignSupportTicketRequest(
    assignedMembershipId: json['assigned_membership_id'] as String,
    reasonCode: json['reason_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'assigned_membership_id': assignedMembershipId,
    'reason_code': reasonCode,
    'expected_version': expectedVersion,
  };
}

class AdvanceSupportTicketRequest {
  const AdvanceSupportTicketRequest({
    required this.status,
    required this.reasonCode,
    this.resolutionCode,
    required this.expectedVersion,
  });

  final String status;
  final String reasonCode;
  final String? resolutionCode;
  final int expectedVersion;

  factory AdvanceSupportTicketRequest.fromJson(Map<String, Object?> json) => AdvanceSupportTicketRequest(
    status: json['status'] as String,
    reasonCode: json['reason_code'] as String,
    resolutionCode: json['resolution_code'] == null ? null : json['resolution_code'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode,
    'resolution_code': resolutionCode,
    'expected_version': expectedVersion,
  };
}

class SupportTicketState {
  const SupportTicketState({
    required this.supportTicketId,
    required this.status,
  });

  final UuidV7 supportTicketId;
  final String status;

  factory SupportTicketState.fromJson(Map<String, Object?> json) => SupportTicketState(
    supportTicketId: json['support_ticket_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'support_ticket_id': supportTicketId,
    'status': status,
  };
}

class RequestExportRequest {
  const RequestExportRequest({
    required this.datasetCode,
    required this.purposeCode,
  });

  final String datasetCode;
  final String purposeCode;

  factory RequestExportRequest.fromJson(Map<String, Object?> json) => RequestExportRequest(
    datasetCode: json['dataset_code'] as String,
    purposeCode: json['purpose_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'dataset_code': datasetCode,
    'purpose_code': purposeCode,
  };
}

class ExportJobCreated {
  const ExportJobCreated({
    required this.exportJobId,
    required this.status,
  });

  final UuidV7 exportJobId;
  final String status;

  factory ExportJobCreated.fromJson(Map<String, Object?> json) => ExportJobCreated(
    exportJobId: json['export_job_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'export_job_id': exportJobId,
    'status': status,
  };
}

class ExportJobView {
  const ExportJobView({
    required this.exportJobId,
    required this.status,
    required this.rowCount,
    required this.downloadable,
  });

  final UuidV7 exportJobId;
  final String status;
  final int? rowCount;
  final bool downloadable;

  factory ExportJobView.fromJson(Map<String, Object?> json) => ExportJobView(
    exportJobId: json['export_job_id'] as String,
    status: json['status'] as String,
    rowCount: json['row_count'] == null ? null : (json['row_count'] as num).toInt(),
    downloadable: json['downloadable'] as bool,
  );

  Map<String, Object?> toJson() => {
    'export_job_id': exportJobId,
    'status': status,
    'row_count': rowCount,
    'downloadable': downloadable,
  };
}

class OrganizationSetting {
  const OrganizationSetting({
    required this.settingKey,
    required this.value,
    required this.version,
  });

  final String settingKey;
  final String value;
  final int version;

  factory OrganizationSetting.fromJson(Map<String, Object?> json) => OrganizationSetting(
    settingKey: json['setting_key'] as String,
    value: json['value'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'setting_key': settingKey,
    'value': value,
    'version': version,
  };
}

class OrganizationSettingList {
  const OrganizationSettingList({
    required this.organizationId,
    required this.data,
  });

  final UuidV7 organizationId;
  final List<OrganizationSetting> data;

  factory OrganizationSettingList.fromJson(Map<String, Object?> json) => OrganizationSettingList(
    organizationId: json['organization_id'] as String,
    data: (json['data'] as List).map((e) => OrganizationSetting.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'organization_id': organizationId,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class UpdateOrganizationSettingRequest {
  const UpdateOrganizationSettingRequest({
    required this.value,
    required this.expectedVersion,
  });

  final String value;
  final int expectedVersion;

  factory UpdateOrganizationSettingRequest.fromJson(Map<String, Object?> json) => UpdateOrganizationSettingRequest(
    value: json['value'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'value': value,
    'expected_version': expectedVersion,
  };
}

class OrganizationSettingUpdated {
  const OrganizationSettingUpdated({
    required this.settingKey,
    required this.version,
  });

  final String settingKey;
  final int version;

  factory OrganizationSettingUpdated.fromJson(Map<String, Object?> json) => OrganizationSettingUpdated(
    settingKey: json['setting_key'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'setting_key': settingKey,
    'version': version,
  };
}

enum PurchaseOrderStatus {
  draft,
  submitted,
  approved,
  ordered,
  partiallyReceived,
  received,
  cancelled,
  unknown,
}

extension PurchaseOrderStatusWire on PurchaseOrderStatus {
  String get wireValue => switch (this) {
    PurchaseOrderStatus.draft => 'draft',
    PurchaseOrderStatus.submitted => 'submitted',
    PurchaseOrderStatus.approved => 'approved',
    PurchaseOrderStatus.ordered => 'ordered',
    PurchaseOrderStatus.partiallyReceived => 'partially_received',
    PurchaseOrderStatus.received => 'received',
    PurchaseOrderStatus.cancelled => 'cancelled',
    PurchaseOrderStatus.unknown => throw StateError('Cannot serialize unknown PurchaseOrderStatus'),
  };
}

PurchaseOrderStatus purchaseOrderStatusFromWire(String value) => switch (value) {
  'draft' => PurchaseOrderStatus.draft,
  'submitted' => PurchaseOrderStatus.submitted,
  'approved' => PurchaseOrderStatus.approved,
  'ordered' => PurchaseOrderStatus.ordered,
  'partially_received' => PurchaseOrderStatus.partiallyReceived,
  'received' => PurchaseOrderStatus.received,
  'cancelled' => PurchaseOrderStatus.cancelled,
  _ => PurchaseOrderStatus.unknown,
};

class CreatePurchaseOrderRequest {
  const CreatePurchaseOrderRequest({
    required this.supplierId,
  });

  final UuidV7 supplierId;

  factory CreatePurchaseOrderRequest.fromJson(Map<String, Object?> json) => CreatePurchaseOrderRequest(
    supplierId: json['supplier_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'supplier_id': supplierId,
  };
}

class PurchaseOrderCreated {
  const PurchaseOrderCreated({
    required this.purchaseOrderId,
    required this.status,
  });

  final UuidV7 purchaseOrderId;
  final String status;

  factory PurchaseOrderCreated.fromJson(Map<String, Object?> json) => PurchaseOrderCreated(
    purchaseOrderId: json['purchase_order_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'purchase_order_id': purchaseOrderId,
    'status': status,
  };
}

class AddPurchaseOrderItemRequest {
  const AddPurchaseOrderItemRequest({
    required this.variantId,
    required this.orderedQuantity,
    required this.unitCostSen,
  });

  final UuidV7 variantId;
  final int orderedQuantity;
  final int unitCostSen;

  factory AddPurchaseOrderItemRequest.fromJson(Map<String, Object?> json) => AddPurchaseOrderItemRequest(
    variantId: json['variant_id'] as String,
    orderedQuantity: (json['ordered_quantity'] as num).toInt(),
    unitCostSen: (json['unit_cost_sen'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'variant_id': variantId,
    'ordered_quantity': orderedQuantity,
    'unit_cost_sen': unitCostSen,
  };
}

class PurchaseOrderItemCreated {
  const PurchaseOrderItemCreated({
    required this.purchaseOrderItemId,
  });

  final UuidV7 purchaseOrderItemId;

  factory PurchaseOrderItemCreated.fromJson(Map<String, Object?> json) => PurchaseOrderItemCreated(
    purchaseOrderItemId: json['purchase_order_item_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'purchase_order_item_id': purchaseOrderItemId,
  };
}

class AdvancePurchaseOrderRequest {
  const AdvancePurchaseOrderRequest({
    required this.status,
    required this.expectedVersion,
  });

  final String status;
  final int expectedVersion;

  factory AdvancePurchaseOrderRequest.fromJson(Map<String, Object?> json) => AdvancePurchaseOrderRequest(
    status: json['status'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'expected_version': expectedVersion,
  };
}

class PurchaseOrderState {
  const PurchaseOrderState({
    required this.purchaseOrderId,
    required this.status,
  });

  final UuidV7 purchaseOrderId;
  final PurchaseOrderStatus status;

  factory PurchaseOrderState.fromJson(Map<String, Object?> json) => PurchaseOrderState(
    purchaseOrderId: json['purchase_order_id'] as String,
    status: purchaseOrderStatusFromWire(json['status'] as String),
  );

  Map<String, Object?> toJson() => {
    'purchase_order_id': purchaseOrderId,
    'status': status.wireValue,
  };
}

class ReceiveGoodsRequest {
  const ReceiveGoodsRequest({
    required this.variantId,
    required this.lotNumber,
    required this.expiresOn,
    required this.receivedQuantity,
  });

  final UuidV7 variantId;
  final String lotNumber;
  final String expiresOn;
  final int receivedQuantity;

  factory ReceiveGoodsRequest.fromJson(Map<String, Object?> json) => ReceiveGoodsRequest(
    variantId: json['variant_id'] as String,
    lotNumber: json['lot_number'] as String,
    expiresOn: json['expires_on'] as String,
    receivedQuantity: (json['received_quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'variant_id': variantId,
    'lot_number': lotNumber,
    'expires_on': expiresOn,
    'received_quantity': receivedQuantity,
  };
}

class GoodsReceiptCreated {
  const GoodsReceiptCreated({
    required this.goodsReceiptId,
    required this.batchId,
    required this.status,
  });

  final UuidV7 goodsReceiptId;
  final UuidV7 batchId;
  final PurchaseOrderStatus status;

  factory GoodsReceiptCreated.fromJson(Map<String, Object?> json) => GoodsReceiptCreated(
    goodsReceiptId: json['goods_receipt_id'] as String,
    batchId: json['batch_id'] as String,
    status: purchaseOrderStatusFromWire(json['status'] as String),
  );

  Map<String, Object?> toJson() => {
    'goods_receipt_id': goodsReceiptId,
    'batch_id': batchId,
    'status': status.wireValue,
  };
}

class CreateReturnRequest {
  const CreateReturnRequest({
    this.pharmacyOrderId,
    required this.reasonCode,
  });

  final UuidV7? pharmacyOrderId;
  final String reasonCode;

  factory CreateReturnRequest.fromJson(Map<String, Object?> json) => CreateReturnRequest(
    pharmacyOrderId: json['pharmacy_order_id'] == null ? null : json['pharmacy_order_id'] as String,
    reasonCode: json['reason_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'pharmacy_order_id': pharmacyOrderId,
    'reason_code': reasonCode,
  };
}

class ReturnCreated {
  const ReturnCreated({
    required this.returnId,
    required this.status,
  });

  final UuidV7 returnId;
  final String status;

  factory ReturnCreated.fromJson(Map<String, Object?> json) => ReturnCreated(
    returnId: json['return_id'] as String,
    status: json['status'] as String,
  );

  Map<String, Object?> toJson() => {
    'return_id': returnId,
    'status': status,
  };
}

class AddReturnItemRequest {
  const AddReturnItemRequest({
    required this.batchId,
    required this.quantity,
  });

  final UuidV7 batchId;
  final int quantity;

  factory AddReturnItemRequest.fromJson(Map<String, Object?> json) => AddReturnItemRequest(
    batchId: json['batch_id'] as String,
    quantity: (json['quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'batch_id': batchId,
    'quantity': quantity,
  };
}

class ReturnItemCreated {
  const ReturnItemCreated({
    required this.returnItemId,
  });

  final UuidV7 returnItemId;

  factory ReturnItemCreated.fromJson(Map<String, Object?> json) => ReturnItemCreated(
    returnItemId: json['return_item_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'return_item_id': returnItemId,
  };
}

class AdvanceReturnRequest {
  const AdvanceReturnRequest({
    required this.status,
    required this.expectedVersion,
  });

  final String status;
  final int expectedVersion;

  factory AdvanceReturnRequest.fromJson(Map<String, Object?> json) => AdvanceReturnRequest(
    status: json['status'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'expected_version': expectedVersion,
  };
}

class ReturnState {
  const ReturnState({
    required this.returnId,
    required this.status,
    required this.postedMovements,
  });

  final UuidV7 returnId;
  final String status;
  final int postedMovements;

  factory ReturnState.fromJson(Map<String, Object?> json) => ReturnState(
    returnId: json['return_id'] as String,
    status: json['status'] as String,
    postedMovements: (json['posted_movements'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'return_id': returnId,
    'status': status,
    'posted_movements': postedMovements,
  };
}

class ReconciliationCreated {
  const ReconciliationCreated({
    required this.reconciliationId,
    required this.status,
    required this.lineCount,
  });

  final UuidV7 reconciliationId;
  final String status;
  final int lineCount;

  factory ReconciliationCreated.fromJson(Map<String, Object?> json) => ReconciliationCreated(
    reconciliationId: json['reconciliation_id'] as String,
    status: json['status'] as String,
    lineCount: (json['line_count'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'reconciliation_id': reconciliationId,
    'status': status,
    'line_count': lineCount,
  };
}

class RecordCountRequest {
  const RecordCountRequest({
    required this.batchId,
    required this.countedQuantity,
  });

  final UuidV7 batchId;
  final int countedQuantity;

  factory RecordCountRequest.fromJson(Map<String, Object?> json) => RecordCountRequest(
    batchId: json['batch_id'] as String,
    countedQuantity: (json['counted_quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'batch_id': batchId,
    'counted_quantity': countedQuantity,
  };
}

class CountRecorded {
  const CountRecorded({
    required this.reconciliationId,
    required this.batchId,
  });

  final UuidV7 reconciliationId;
  final UuidV7 batchId;

  factory CountRecorded.fromJson(Map<String, Object?> json) => CountRecorded(
    reconciliationId: json['reconciliation_id'] as String,
    batchId: json['batch_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'reconciliation_id': reconciliationId,
    'batch_id': batchId,
  };
}

class AdvanceReconciliationRequest {
  const AdvanceReconciliationRequest({
    required this.status,
    required this.expectedVersion,
  });

  final String status;
  final int expectedVersion;

  factory AdvanceReconciliationRequest.fromJson(Map<String, Object?> json) => AdvanceReconciliationRequest(
    status: json['status'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'expected_version': expectedVersion,
  };
}

class ReconciliationState {
  const ReconciliationState({
    required this.reconciliationId,
    required this.status,
    required this.adjustmentsPosted,
  });

  final UuidV7 reconciliationId;
  final String status;
  final int adjustmentsPosted;

  factory ReconciliationState.fromJson(Map<String, Object?> json) => ReconciliationState(
    reconciliationId: json['reconciliation_id'] as String,
    status: json['status'] as String,
    adjustmentsPosted: (json['adjustments_posted'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'reconciliation_id': reconciliationId,
    'status': status,
    'adjustments_posted': adjustmentsPosted,
  };
}

enum ControlledSubstanceSchedule {
  none,
  schedule2,
  schedule3,
  schedule4,
  schedule5,
  unknown,
}

extension ControlledSubstanceScheduleWire on ControlledSubstanceSchedule {
  String get wireValue => switch (this) {
    ControlledSubstanceSchedule.none => 'none',
    ControlledSubstanceSchedule.schedule2 => 'schedule_2',
    ControlledSubstanceSchedule.schedule3 => 'schedule_3',
    ControlledSubstanceSchedule.schedule4 => 'schedule_4',
    ControlledSubstanceSchedule.schedule5 => 'schedule_5',
    ControlledSubstanceSchedule.unknown => throw StateError('Cannot serialize unknown ControlledSubstanceSchedule'),
  };
}

ControlledSubstanceSchedule controlledSubstanceScheduleFromWire(String value) => switch (value) {
  'none' => ControlledSubstanceSchedule.none,
  'schedule_2' => ControlledSubstanceSchedule.schedule2,
  'schedule_3' => ControlledSubstanceSchedule.schedule3,
  'schedule_4' => ControlledSubstanceSchedule.schedule4,
  'schedule_5' => ControlledSubstanceSchedule.schedule5,
  _ => ControlledSubstanceSchedule.unknown,
};

class OpenControlledRegisterRequest {
  const OpenControlledRegisterRequest({
    required this.variantId,
  });

  final UuidV7 variantId;

  factory OpenControlledRegisterRequest.fromJson(Map<String, Object?> json) => OpenControlledRegisterRequest(
    variantId: json['variant_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'variant_id': variantId,
  };
}

class ControlledRegister {
  const ControlledRegister({
    required this.registerId,
    required this.schedule,
  });

  final UuidV7 registerId;
  final ControlledSubstanceSchedule schedule;

  factory ControlledRegister.fromJson(Map<String, Object?> json) => ControlledRegister(
    registerId: json['register_id'] as String,
    schedule: controlledSubstanceScheduleFromWire(json['schedule'] as String),
  );

  Map<String, Object?> toJson() => {
    'register_id': registerId,
    'schedule': schedule.wireValue,
  };
}

class RecordControlledMovementRequest {
  const RecordControlledMovementRequest({
    required this.batchId,
    required this.quantityDelta,
    required this.reasonCode,
    required this.witnessProfileId,
  });

  final UuidV7 batchId;
  final int quantityDelta;
  final String reasonCode;
  final String witnessProfileId;

  factory RecordControlledMovementRequest.fromJson(Map<String, Object?> json) => RecordControlledMovementRequest(
    batchId: json['batch_id'] as String,
    quantityDelta: (json['quantity_delta'] as num).toInt(),
    reasonCode: json['reason_code'] as String,
    witnessProfileId: json['witness_profile_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'batch_id': batchId,
    'quantity_delta': quantityDelta,
    'reason_code': reasonCode,
    'witness_profile_id': witnessProfileId,
  };
}

class ControlledMovementRecorded {
  const ControlledMovementRecorded({
    required this.csEventId,
    required this.movementId,
    required this.projectedQuantity,
  });

  final UuidV7 csEventId;
  final UuidV7 movementId;
  final int projectedQuantity;

  factory ControlledMovementRecorded.fromJson(Map<String, Object?> json) => ControlledMovementRecorded(
    csEventId: json['cs_event_id'] as String,
    movementId: json['movement_id'] as String,
    projectedQuantity: (json['projected_quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'cs_event_id': csEventId,
    'movement_id': movementId,
    'projected_quantity': projectedQuantity,
  };
}

enum WithdrawalStatus {
  requested,
  underReview,
  approved,
  processing,
  paid,
  failed,
  rejected,
  cancelled,
  unknown,
}

extension WithdrawalStatusWire on WithdrawalStatus {
  String get wireValue => switch (this) {
    WithdrawalStatus.requested => 'requested',
    WithdrawalStatus.underReview => 'under_review',
    WithdrawalStatus.approved => 'approved',
    WithdrawalStatus.processing => 'processing',
    WithdrawalStatus.paid => 'paid',
    WithdrawalStatus.failed => 'failed',
    WithdrawalStatus.rejected => 'rejected',
    WithdrawalStatus.cancelled => 'cancelled',
    WithdrawalStatus.unknown => throw StateError('Cannot serialize unknown WithdrawalStatus'),
  };
}

WithdrawalStatus withdrawalStatusFromWire(String value) => switch (value) {
  'requested' => WithdrawalStatus.requested,
  'under_review' => WithdrawalStatus.underReview,
  'approved' => WithdrawalStatus.approved,
  'processing' => WithdrawalStatus.processing,
  'paid' => WithdrawalStatus.paid,
  'failed' => WithdrawalStatus.failed,
  'rejected' => WithdrawalStatus.rejected,
  'cancelled' => WithdrawalStatus.cancelled,
  _ => WithdrawalStatus.unknown,
};

class RegisterBankAccountRequest {
  const RegisterBankAccountRequest({
    required this.bankCode,
    required this.accountNumber,
  });

  final String bankCode;
  final String accountNumber;

  factory RegisterBankAccountRequest.fromJson(Map<String, Object?> json) => RegisterBankAccountRequest(
    bankCode: json['bank_code'] as String,
    accountNumber: json['account_number'] as String,
  );

  Map<String, Object?> toJson() => {
    'bank_code': bankCode,
    'account_number': accountNumber,
  };
}

class BankAccountRegistered {
  const BankAccountRegistered({
    required this.bankAccountId,
    required this.accountLast4,
  });

  final UuidV7 bankAccountId;
  final String accountLast4;

  factory BankAccountRegistered.fromJson(Map<String, Object?> json) => BankAccountRegistered(
    bankAccountId: json['bank_account_id'] as String,
    accountLast4: json['account_last4'] as String,
  );

  Map<String, Object?> toJson() => {
    'bank_account_id': bankAccountId,
    'account_last4': accountLast4,
  };
}

class RequestWithdrawalRequest {
  const RequestWithdrawalRequest({
    required this.bankAccountId,
    required this.amountSen,
  });

  final UuidV7 bankAccountId;
  final int amountSen;

  factory RequestWithdrawalRequest.fromJson(Map<String, Object?> json) => RequestWithdrawalRequest(
    bankAccountId: json['bank_account_id'] as String,
    amountSen: (json['amount_sen'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'bank_account_id': bankAccountId,
    'amount_sen': amountSen,
  };
}

class WithdrawalRequested {
  const WithdrawalRequested({
    required this.withdrawalId,
    required this.status,
    required this.remainingSen,
  });

  final UuidV7 withdrawalId;
  final String status;
  final int remainingSen;

  factory WithdrawalRequested.fromJson(Map<String, Object?> json) => WithdrawalRequested(
    withdrawalId: json['withdrawal_id'] as String,
    status: json['status'] as String,
    remainingSen: (json['remaining_sen'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'withdrawal_id': withdrawalId,
    'status': status,
    'remaining_sen': remainingSen,
  };
}

class AdvanceWithdrawalRequest {
  const AdvanceWithdrawalRequest({
    required this.status,
    this.reasonCode,
    this.payableAccountId,
    this.cashAccountId,
    required this.expectedVersion,
  });

  final String status;
  final String? reasonCode;
  final UuidV7? payableAccountId;
  final UuidV7? cashAccountId;
  final int expectedVersion;

  factory AdvanceWithdrawalRequest.fromJson(Map<String, Object?> json) => AdvanceWithdrawalRequest(
    status: json['status'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    payableAccountId: json['payable_account_id'] == null ? null : json['payable_account_id'] as String,
    cashAccountId: json['cash_account_id'] == null ? null : json['cash_account_id'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'reason_code': reasonCode,
    'payable_account_id': payableAccountId,
    'cash_account_id': cashAccountId,
    'expected_version': expectedVersion,
  };
}

class WithdrawalState {
  const WithdrawalState({
    required this.withdrawalId,
    required this.status,
    required this.ledgerEntryId,
  });

  final UuidV7 withdrawalId;
  final WithdrawalStatus status;
  final UuidV7? ledgerEntryId;

  factory WithdrawalState.fromJson(Map<String, Object?> json) => WithdrawalState(
    withdrawalId: json['withdrawal_id'] as String,
    status: withdrawalStatusFromWire(json['status'] as String),
    ledgerEntryId: json['ledger_entry_id'] == null ? null : json['ledger_entry_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'withdrawal_id': withdrawalId,
    'status': status.wireValue,
    'ledger_entry_id': ledgerEntryId,
  };
}

class Medication {
  const Medication({
    required this.medicationId,
    required this.genericName,
    required this.atcCode,
    required this.controlledSchedule,
    required this.controlledSubstance,
    required this.requiresPrescription,
    required this.retired,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 medicationId;
  final String genericName;
  final String? atcCode;
  final ControlledSubstanceSchedule controlledSchedule;
  final bool controlledSubstance;
  final bool requiresPrescription;
  final bool retired;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory Medication.fromJson(Map<String, Object?> json) => Medication(
    medicationId: json['medication_id'] as String,
    genericName: json['generic_name'] as String,
    atcCode: json['atc_code'] == null ? null : json['atc_code'] as String,
    controlledSchedule: controlledSubstanceScheduleFromWire(json['controlled_schedule'] as String),
    controlledSubstance: json['controlled_substance'] as bool,
    requiresPrescription: json['requires_prescription'] as bool,
    retired: json['retired'] as bool,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'medication_id': medicationId,
    'generic_name': genericName,
    'atc_code': atcCode,
    'controlled_schedule': controlledSchedule.wireValue,
    'controlled_substance': controlledSubstance,
    'requires_prescription': requiresPrescription,
    'retired': retired,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class MedicationList {
  const MedicationList({
    required this.data,
  });

  final List<Medication> data;

  factory MedicationList.fromJson(Map<String, Object?> json) => MedicationList(
    data: (json['data'] as List).map((e) => Medication.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class CreateMedicationRequest {
  const CreateMedicationRequest({
    required this.genericName,
    this.atcCode,
    this.controlledSchedule,
    this.requiresPrescription,
  });

  final String genericName;
  final String? atcCode;
  final ControlledSubstanceSchedule? controlledSchedule;
  final bool? requiresPrescription;

  factory CreateMedicationRequest.fromJson(Map<String, Object?> json) => CreateMedicationRequest(
    genericName: json['generic_name'] as String,
    atcCode: json['atc_code'] == null ? null : json['atc_code'] as String,
    controlledSchedule: json['controlled_schedule'] == null ? null : controlledSubstanceScheduleFromWire(json['controlled_schedule'] as String),
    requiresPrescription: json['requires_prescription'] == null ? null : json['requires_prescription'] as bool,
  );

  Map<String, Object?> toJson() => {
    'generic_name': genericName,
    'atc_code': atcCode,
    'controlled_schedule': controlledSchedule?.wireValue,
    'requires_prescription': requiresPrescription,
  };
}

class UpdateMedicationRequest {
  const UpdateMedicationRequest({
    required this.genericName,
    required this.atcCode,
    required this.controlledSchedule,
    required this.requiresPrescription,
    required this.retired,
    required this.expectedVersion,
  });

  final String genericName;
  final String? atcCode;
  final ControlledSubstanceSchedule controlledSchedule;
  final bool requiresPrescription;
  final bool retired;
  final int expectedVersion;

  factory UpdateMedicationRequest.fromJson(Map<String, Object?> json) => UpdateMedicationRequest(
    genericName: json['generic_name'] as String,
    atcCode: json['atc_code'] == null ? null : json['atc_code'] as String,
    controlledSchedule: controlledSubstanceScheduleFromWire(json['controlled_schedule'] as String),
    requiresPrescription: json['requires_prescription'] as bool,
    retired: json['retired'] as bool,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'generic_name': genericName,
    'atc_code': atcCode,
    'controlled_schedule': controlledSchedule.wireValue,
    'requires_prescription': requiresPrescription,
    'retired': retired,
    'expected_version': expectedVersion,
  };
}

class InventoryBatch {
  const InventoryBatch({
    required this.batchId,
    required this.variantId,
    required this.lotNumber,
    required this.expiresOn,
    required this.status,
    required this.postedQuantity,
    required this.reservedQuantity,
    required this.availableQuantity,
  });

  final UuidV7 batchId;
  final UuidV7 variantId;
  final String lotNumber;
  final String expiresOn;
  final String status;
  final int postedQuantity;
  final int reservedQuantity;
  final int availableQuantity;

  factory InventoryBatch.fromJson(Map<String, Object?> json) => InventoryBatch(
    batchId: json['batch_id'] as String,
    variantId: json['variant_id'] as String,
    lotNumber: json['lot_number'] as String,
    expiresOn: json['expires_on'] as String,
    status: json['status'] as String,
    postedQuantity: (json['posted_quantity'] as num).toInt(),
    reservedQuantity: (json['reserved_quantity'] as num).toInt(),
    availableQuantity: (json['available_quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'batch_id': batchId,
    'variant_id': variantId,
    'lot_number': lotNumber,
    'expires_on': expiresOn,
    'status': status,
    'posted_quantity': postedQuantity,
    'reserved_quantity': reservedQuantity,
    'available_quantity': availableQuantity,
  };
}

class InventoryBatchList {
  const InventoryBatchList({
    required this.siteId,
    required this.data,
  });

  final UuidV7 siteId;
  final List<InventoryBatch> data;

  factory InventoryBatchList.fromJson(Map<String, Object?> json) => InventoryBatchList(
    siteId: json['site_id'] as String,
    data: (json['data'] as List).map((e) => InventoryBatch.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'site_id': siteId,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class StockMovement {
  const StockMovement({
    required this.movementId,
    required this.batchId,
    required this.movementType,
    required this.quantityDelta,
    required this.referenceType,
    required this.referenceId,
    required this.reasonCode,
    required this.occurredAt,
  });

  final UuidV7 movementId;
  final UuidV7 batchId;
  final String movementType;
  final int quantityDelta;
  final String referenceType;
  final UuidV7? referenceId;
  final String? reasonCode;
  final Timestamp occurredAt;

  factory StockMovement.fromJson(Map<String, Object?> json) => StockMovement(
    movementId: json['movement_id'] as String,
    batchId: json['batch_id'] as String,
    movementType: json['movement_type'] as String,
    quantityDelta: (json['quantity_delta'] as num).toInt(),
    referenceType: json['reference_type'] as String,
    referenceId: json['reference_id'] == null ? null : json['reference_id'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    occurredAt: json['occurred_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'movement_id': movementId,
    'batch_id': batchId,
    'movement_type': movementType,
    'quantity_delta': quantityDelta,
    'reference_type': referenceType,
    'reference_id': referenceId,
    'reason_code': reasonCode,
    'occurred_at': occurredAt,
  };
}

class StockMovementList {
  const StockMovementList({
    required this.siteId,
    required this.data,
  });

  final UuidV7 siteId;
  final List<StockMovement> data;

  factory StockMovementList.fromJson(Map<String, Object?> json) => StockMovementList(
    siteId: json['site_id'] as String,
    data: (json['data'] as List).map((e) => StockMovement.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'site_id': siteId,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class PharmacyOrderItemRequest {
  const PharmacyOrderItemRequest({
    required this.variantId,
    required this.quantity,
  });

  final UuidV7 variantId;
  final int quantity;

  factory PharmacyOrderItemRequest.fromJson(Map<String, Object?> json) => PharmacyOrderItemRequest(
    variantId: json['variant_id'] as String,
    quantity: (json['quantity'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'variant_id': variantId,
    'quantity': quantity,
  };
}

class CreatePharmacyOrderRequest {
  const CreatePharmacyOrderRequest({
    required this.siteId,
    required this.prescriptionId,
    required this.items,
  });

  final UuidV7 siteId;
  final UuidV7 prescriptionId;
  final List<PharmacyOrderItemRequest> items;

  factory CreatePharmacyOrderRequest.fromJson(Map<String, Object?> json) => CreatePharmacyOrderRequest(
    siteId: json['site_id'] as String,
    prescriptionId: json['prescription_id'] as String,
    items: (json['items'] as List).map((e) => PharmacyOrderItemRequest.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'site_id': siteId,
    'prescription_id': prescriptionId,
    'items': items.map((e) => e.toJson()).toList(),
  };
}

class PharmacyOrderItem {
  const PharmacyOrderItem({
    required this.orderItemId,
    required this.variantId,
    required this.position,
    required this.quantity,
    required this.unitPriceSen,
    required this.currency,
  });

  final UuidV7 orderItemId;
  final UuidV7 variantId;
  final int position;
  final int quantity;
  final int unitPriceSen;
  final String currency;

  factory PharmacyOrderItem.fromJson(Map<String, Object?> json) => PharmacyOrderItem(
    orderItemId: json['order_item_id'] as String,
    variantId: json['variant_id'] as String,
    position: (json['position'] as num).toInt(),
    quantity: (json['quantity'] as num).toInt(),
    unitPriceSen: (json['unit_price_sen'] as num).toInt(),
    currency: json['currency'] as String,
  );

  Map<String, Object?> toJson() => {
    'order_item_id': orderItemId,
    'variant_id': variantId,
    'position': position,
    'quantity': quantity,
    'unit_price_sen': unitPriceSen,
    'currency': currency,
  };
}

class PharmacyOrder {
  const PharmacyOrder({
    required this.pharmacyOrderId,
    required this.siteId,
    required this.patientProfileId,
    required this.prescriptionId,
    required this.status,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
    required this.items,
  });

  final UuidV7 pharmacyOrderId;
  final UuidV7 siteId;
  final UuidV7 patientProfileId;
  final UuidV7? prescriptionId;
  final PharmacyOrderStatus status;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;
  final List<PharmacyOrderItem> items;

  factory PharmacyOrder.fromJson(Map<String, Object?> json) => PharmacyOrder(
    pharmacyOrderId: json['pharmacy_order_id'] as String,
    siteId: json['site_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    prescriptionId: json['prescription_id'] == null ? null : json['prescription_id'] as String,
    status: pharmacyOrderStatusFromWire(json['status'] as String),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
    items: (json['items'] as List).map((e) => PharmacyOrderItem.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'pharmacy_order_id': pharmacyOrderId,
    'site_id': siteId,
    'patient_profile_id': patientProfileId,
    'prescription_id': prescriptionId,
    'status': status.wireValue,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
    'items': items.map((e) => e.toJson()).toList(),
  };
}

class PharmacyOrderList {
  const PharmacyOrderList({
    required this.data,
  });

  final List<PharmacyOrder> data;

  factory PharmacyOrderList.fromJson(Map<String, Object?> json) => PharmacyOrderList(
    data: (json['data'] as List).map((e) => PharmacyOrder.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class CreateVehicleRequest {
  const CreateVehicleRequest({
    required this.plateNumber,
    required this.vehicleType,
  });

  final String plateNumber;
  final String vehicleType;

  factory CreateVehicleRequest.fromJson(Map<String, Object?> json) => CreateVehicleRequest(
    plateNumber: json['plate_number'] as String,
    vehicleType: json['vehicle_type'] as String,
  );

  Map<String, Object?> toJson() => {
    'plate_number': plateNumber,
    'vehicle_type': vehicleType,
  };
}

class UpdateVehicleRequest {
  const UpdateVehicleRequest({
    required this.plateNumber,
    required this.vehicleType,
    required this.active,
    required this.expectedVersion,
  });

  final String plateNumber;
  final String vehicleType;
  final bool active;
  final int expectedVersion;

  factory UpdateVehicleRequest.fromJson(Map<String, Object?> json) => UpdateVehicleRequest(
    plateNumber: json['plate_number'] as String,
    vehicleType: json['vehicle_type'] as String,
    active: json['active'] as bool,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'plate_number': plateNumber,
    'vehicle_type': vehicleType,
    'active': active,
    'expected_version': expectedVersion,
  };
}

class Vehicle {
  const Vehicle({
    required this.vehicleId,
    required this.plateNumber,
    required this.vehicleType,
    required this.active,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 vehicleId;
  final String plateNumber;
  final String vehicleType;
  final bool active;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory Vehicle.fromJson(Map<String, Object?> json) => Vehicle(
    vehicleId: json['vehicle_id'] as String,
    plateNumber: json['plate_number'] as String,
    vehicleType: json['vehicle_type'] as String,
    active: json['active'] as bool,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'vehicle_id': vehicleId,
    'plate_number': plateNumber,
    'vehicle_type': vehicleType,
    'active': active,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class VehicleList {
  const VehicleList({
    required this.data,
  });

  final List<Vehicle> data;

  factory VehicleList.fromJson(Map<String, Object?> json) => VehicleList(
    data: (json['data'] as List).map((e) => Vehicle.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class CreateDeliveryRatingRequest {
  const CreateDeliveryRatingRequest({
    required this.stars,
  });

  final int stars;

  factory CreateDeliveryRatingRequest.fromJson(Map<String, Object?> json) => CreateDeliveryRatingRequest(
    stars: (json['stars'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'stars': stars,
  };
}

class DeliveryRating {
  const DeliveryRating({
    required this.ratingId,
    required this.deliveryId,
    required this.stars,
    required this.createdAt,
  });

  final UuidV7 ratingId;
  final UuidV7 deliveryId;
  final int stars;
  final Timestamp createdAt;

  factory DeliveryRating.fromJson(Map<String, Object?> json) => DeliveryRating(
    ratingId: json['rating_id'] as String,
    deliveryId: json['delivery_id'] as String,
    stars: (json['stars'] as num).toInt(),
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'rating_id': ratingId,
    'delivery_id': deliveryId,
    'stars': stars,
    'created_at': createdAt,
  };
}

class DriverRatingList {
  const DriverRatingList({
    required this.driverId,
    required this.averageStars,
    required this.totalRatings,
    required this.data,
  });

  final UuidV7 driverId;
  final double? averageStars;
  final int totalRatings;
  final List<DeliveryRating> data;

  factory DriverRatingList.fromJson(Map<String, Object?> json) => DriverRatingList(
    driverId: json['driver_id'] as String,
    averageStars: json['average_stars'] == null ? null : (json['average_stars'] as num).toDouble(),
    totalRatings: (json['total_ratings'] as num).toInt(),
    data: (json['data'] as List).map((e) => DeliveryRating.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'driver_id': driverId,
    'average_stars': averageStars,
    'total_ratings': totalRatings,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class FaqEntry {
  const FaqEntry({
    required this.faqEntryId,
    required this.slug,
    required this.question,
    required this.answer,
    required this.publishState,
    required this.publishedAt,
    required this.version,
    required this.updatedAt,
  });

  final String faqEntryId;
  final String slug;
  final String question;
  final String answer;
  final String publishState;
  final String? publishedAt;
  final int version;
  final String updatedAt;

  factory FaqEntry.fromJson(Map<String, Object?> json) => FaqEntry(
    faqEntryId: json['faq_entry_id'] as String,
    slug: json['slug'] as String,
    question: json['question'] as String,
    answer: json['answer'] as String,
    publishState: json['publish_state'] as String,
    publishedAt: json['published_at'] == null ? null : json['published_at'] as String,
    version: (json['version'] as num).toInt(),
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'faq_entry_id': faqEntryId,
    'slug': slug,
    'question': question,
    'answer': answer,
    'publish_state': publishState,
    'published_at': publishedAt,
    'version': version,
    'updated_at': updatedAt,
  };
}

class FaqEntryList {
  const FaqEntryList({
    required this.data,
  });

  final List<FaqEntry> data;

  factory FaqEntryList.fromJson(Map<String, Object?> json) => FaqEntryList(
    data: (json['data'] as List).map((e) => FaqEntry.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class CreateFaqEntryRequest {
  const CreateFaqEntryRequest({
    required this.slug,
    required this.question,
    required this.answer,
  });

  final String slug;
  final String question;
  final String answer;

  factory CreateFaqEntryRequest.fromJson(Map<String, Object?> json) => CreateFaqEntryRequest(
    slug: json['slug'] as String,
    question: json['question'] as String,
    answer: json['answer'] as String,
  );

  Map<String, Object?> toJson() => {
    'slug': slug,
    'question': question,
    'answer': answer,
  };
}

class UpdateFaqEntryRequest {
  const UpdateFaqEntryRequest({
    required this.slug,
    required this.question,
    required this.answer,
    required this.expectedVersion,
  });

  final String slug;
  final String question;
  final String answer;
  final int expectedVersion;

  factory UpdateFaqEntryRequest.fromJson(Map<String, Object?> json) => UpdateFaqEntryRequest(
    slug: json['slug'] as String,
    question: json['question'] as String,
    answer: json['answer'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'slug': slug,
    'question': question,
    'answer': answer,
    'expected_version': expectedVersion,
  };
}

class SetFaqPublishStateRequest {
  const SetFaqPublishStateRequest({
    required this.publishState,
    required this.expectedVersion,
  });

  final String publishState;
  final int expectedVersion;

  factory SetFaqPublishStateRequest.fromJson(Map<String, Object?> json) => SetFaqPublishStateRequest(
    publishState: json['publish_state'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'publish_state': publishState,
    'expected_version': expectedVersion,
  };
}

class ArchiveFaqEntryRequest {
  const ArchiveFaqEntryRequest({
    required this.expectedVersion,
  });

  final int expectedVersion;

  factory ArchiveFaqEntryRequest.fromJson(Map<String, Object?> json) => ArchiveFaqEntryRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
  };
}

class NotificationTemplate {
  const NotificationTemplate({
    required this.notificationTemplateId,
    required this.templateKey,
    required this.category,
    required this.activeVersion,
    required this.updatedAt,
  });

  final String notificationTemplateId;
  final String templateKey;
  final String category;
  final int? activeVersion;
  final String updatedAt;

  factory NotificationTemplate.fromJson(Map<String, Object?> json) => NotificationTemplate(
    notificationTemplateId: json['notification_template_id'] as String,
    templateKey: json['template_key'] as String,
    category: json['category'] as String,
    activeVersion: json['active_version'] == null ? null : (json['active_version'] as num).toInt(),
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'notification_template_id': notificationTemplateId,
    'template_key': templateKey,
    'category': category,
    'active_version': activeVersion,
    'updated_at': updatedAt,
  };
}

class NotificationTemplateList {
  const NotificationTemplateList({
    required this.data,
  });

  final List<NotificationTemplate> data;

  factory NotificationTemplateList.fromJson(Map<String, Object?> json) => NotificationTemplateList(
    data: (json['data'] as List).map((e) => NotificationTemplate.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class CreateNotificationTemplateRequest {
  const CreateNotificationTemplateRequest({
    required this.templateKey,
    required this.category,
    required this.titleTemplate,
    required this.bodyTemplate,
  });

  final String templateKey;
  final String category;
  final String titleTemplate;
  final String bodyTemplate;

  factory CreateNotificationTemplateRequest.fromJson(Map<String, Object?> json) => CreateNotificationTemplateRequest(
    templateKey: json['template_key'] as String,
    category: json['category'] as String,
    titleTemplate: json['title_template'] as String,
    bodyTemplate: json['body_template'] as String,
  );

  Map<String, Object?> toJson() => {
    'template_key': templateKey,
    'category': category,
    'title_template': titleTemplate,
    'body_template': bodyTemplate,
  };
}

class NotificationTemplateVersion {
  const NotificationTemplateVersion({
    required this.notificationTemplateVersionId,
    required this.version,
    required this.titleTemplate,
    required this.bodyTemplate,
    required this.createdAt,
  });

  final String notificationTemplateVersionId;
  final int version;
  final String titleTemplate;
  final String bodyTemplate;
  final String createdAt;

  factory NotificationTemplateVersion.fromJson(Map<String, Object?> json) => NotificationTemplateVersion(
    notificationTemplateVersionId: json['notification_template_version_id'] as String,
    version: (json['version'] as num).toInt(),
    titleTemplate: json['title_template'] as String,
    bodyTemplate: json['body_template'] as String,
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'notification_template_version_id': notificationTemplateVersionId,
    'version': version,
    'title_template': titleTemplate,
    'body_template': bodyTemplate,
    'created_at': createdAt,
  };
}

class NotificationTemplateVersionList {
  const NotificationTemplateVersionList({
    required this.data,
  });

  final List<NotificationTemplateVersion> data;

  factory NotificationTemplateVersionList.fromJson(Map<String, Object?> json) => NotificationTemplateVersionList(
    data: (json['data'] as List).map((e) => NotificationTemplateVersion.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class AddNotificationTemplateVersionRequest {
  const AddNotificationTemplateVersionRequest({
    required this.titleTemplate,
    required this.bodyTemplate,
  });

  final String titleTemplate;
  final String bodyTemplate;

  factory AddNotificationTemplateVersionRequest.fromJson(Map<String, Object?> json) => AddNotificationTemplateVersionRequest(
    titleTemplate: json['title_template'] as String,
    bodyTemplate: json['body_template'] as String,
  );

  Map<String, Object?> toJson() => {
    'title_template': titleTemplate,
    'body_template': bodyTemplate,
  };
}

class ActivateNotificationTemplateVersionRequest {
  const ActivateNotificationTemplateVersionRequest({
    required this.version,
  });

  final int version;

  factory ActivateNotificationTemplateVersionRequest.fromJson(Map<String, Object?> json) => ActivateNotificationTemplateVersionRequest(
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'version': version,
  };
}

class NotificationTemplateActiveVersion {
  const NotificationTemplateActiveVersion({
    required this.templateKey,
    required this.activeVersion,
  });

  final String templateKey;
  final int activeVersion;

  factory NotificationTemplateActiveVersion.fromJson(Map<String, Object?> json) => NotificationTemplateActiveVersion(
    templateKey: json['template_key'] as String,
    activeVersion: (json['active_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'template_key': templateKey,
    'active_version': activeVersion,
  };
}

class BroadcastMessage {
  const BroadcastMessage({
    required this.broadcastMessageId,
    required this.notificationTemplateVersionId,
    required this.audience,
    required this.status,
    required this.scheduledAt,
    required this.dispatchedAt,
    required this.version,
    required this.createdAt,
  });

  final String broadcastMessageId;
  final String notificationTemplateVersionId;
  final String audience;
  final String status;
  final String? scheduledAt;
  final String? dispatchedAt;
  final int version;
  final String createdAt;

  factory BroadcastMessage.fromJson(Map<String, Object?> json) => BroadcastMessage(
    broadcastMessageId: json['broadcast_message_id'] as String,
    notificationTemplateVersionId: json['notification_template_version_id'] as String,
    audience: json['audience'] as String,
    status: json['status'] as String,
    scheduledAt: json['scheduled_at'] == null ? null : json['scheduled_at'] as String,
    dispatchedAt: json['dispatched_at'] == null ? null : json['dispatched_at'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'broadcast_message_id': broadcastMessageId,
    'notification_template_version_id': notificationTemplateVersionId,
    'audience': audience,
    'status': status,
    'scheduled_at': scheduledAt,
    'dispatched_at': dispatchedAt,
    'version': version,
    'created_at': createdAt,
  };
}

class BroadcastMessageList {
  const BroadcastMessageList({
    required this.data,
  });

  final List<BroadcastMessage> data;

  factory BroadcastMessageList.fromJson(Map<String, Object?> json) => BroadcastMessageList(
    data: (json['data'] as List).map((e) => BroadcastMessage.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class CreateBroadcastMessageRequest {
  const CreateBroadcastMessageRequest({
    required this.templateKey,
    required this.templateVersion,
    required this.audience,
  });

  final String templateKey;
  final int templateVersion;
  final String audience;

  factory CreateBroadcastMessageRequest.fromJson(Map<String, Object?> json) => CreateBroadcastMessageRequest(
    templateKey: json['template_key'] as String,
    templateVersion: (json['template_version'] as num).toInt(),
    audience: json['audience'] as String,
  );

  Map<String, Object?> toJson() => {
    'template_key': templateKey,
    'template_version': templateVersion,
    'audience': audience,
  };
}

class ScheduleBroadcastMessageRequest {
  const ScheduleBroadcastMessageRequest({
    required this.scheduledAt,
    required this.expectedVersion,
  });

  final String scheduledAt;
  final int expectedVersion;

  factory ScheduleBroadcastMessageRequest.fromJson(Map<String, Object?> json) => ScheduleBroadcastMessageRequest(
    scheduledAt: json['scheduled_at'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'scheduled_at': scheduledAt,
    'expected_version': expectedVersion,
  };
}

class SendBroadcastMessageRequest {
  const SendBroadcastMessageRequest({
    required this.expectedVersion,
  });

  final int expectedVersion;

  factory SendBroadcastMessageRequest.fromJson(Map<String, Object?> json) => SendBroadcastMessageRequest(
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'expected_version': expectedVersion,
  };
}

class BroadcastMessageQueued {
  const BroadcastMessageQueued({
    required this.broadcastMessageId,
    required this.status,
    required this.scheduledAt,
  });

  final String broadcastMessageId;
  final String status;
  final String scheduledAt;

  factory BroadcastMessageQueued.fromJson(Map<String, Object?> json) => BroadcastMessageQueued(
    broadcastMessageId: json['broadcast_message_id'] as String,
    status: json['status'] as String,
    scheduledAt: json['scheduled_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'broadcast_message_id': broadcastMessageId,
    'status': status,
    'scheduled_at': scheduledAt,
  };
}

class CustomRole {
  const CustomRole({
    required this.customRoleId,
    required this.roleKey,
    required this.displayName,
    required this.baseRoleId,
    required this.active,
    required this.permissionIds,
    required this.version,
    required this.updatedAt,
  });

  final String customRoleId;
  final String roleKey;
  final String displayName;
  final String baseRoleId;
  final bool active;
  final List<String> permissionIds;
  final int version;
  final String updatedAt;

  factory CustomRole.fromJson(Map<String, Object?> json) => CustomRole(
    customRoleId: json['custom_role_id'] as String,
    roleKey: json['role_key'] as String,
    displayName: json['display_name'] as String,
    baseRoleId: json['base_role_id'] as String,
    active: json['active'] as bool,
    permissionIds: List<String>.from(json['permission_ids'] as List),
    version: (json['version'] as num).toInt(),
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'custom_role_id': customRoleId,
    'role_key': roleKey,
    'display_name': displayName,
    'base_role_id': baseRoleId,
    'active': active,
    'permission_ids': permissionIds,
    'version': version,
    'updated_at': updatedAt,
  };
}

class CustomRoleList {
  const CustomRoleList({
    required this.data,
  });

  final List<CustomRole> data;

  factory CustomRoleList.fromJson(Map<String, Object?> json) => CustomRoleList(
    data: (json['data'] as List).map((e) => CustomRole.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class Permission {
  const Permission({
    required this.permissionId,
    required this.description,
  });

  final String permissionId;
  final String? description;

  factory Permission.fromJson(Map<String, Object?> json) => Permission(
    permissionId: json['permission_id'] as String,
    description: json['description'] == null ? null : json['description'] as String,
  );

  Map<String, Object?> toJson() => {
    'permission_id': permissionId,
    'description': description,
  };
}

class PermissionList {
  const PermissionList({
    required this.data,
  });

  final List<Permission> data;

  factory PermissionList.fromJson(Map<String, Object?> json) => PermissionList(
    data: (json['data'] as List).map((e) => Permission.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class CreateCustomRoleRequest {
  const CreateCustomRoleRequest({
    required this.roleKey,
    required this.displayName,
    required this.baseRoleId,
  });

  final String roleKey;
  final String displayName;
  final String baseRoleId;

  factory CreateCustomRoleRequest.fromJson(Map<String, Object?> json) => CreateCustomRoleRequest(
    roleKey: json['role_key'] as String,
    displayName: json['display_name'] as String,
    baseRoleId: json['base_role_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'role_key': roleKey,
    'display_name': displayName,
    'base_role_id': baseRoleId,
  };
}

class UpdateCustomRoleRequest {
  const UpdateCustomRoleRequest({
    required this.displayName,
    required this.active,
    required this.expectedVersion,
  });

  final String displayName;
  final bool active;
  final int expectedVersion;

  factory UpdateCustomRoleRequest.fromJson(Map<String, Object?> json) => UpdateCustomRoleRequest(
    displayName: json['display_name'] as String,
    active: json['active'] as bool,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'display_name': displayName,
    'active': active,
    'expected_version': expectedVersion,
  };
}

class ReplaceCustomRolePermissionsRequest {
  const ReplaceCustomRolePermissionsRequest({
    required this.permissionIds,
    required this.expectedVersion,
  });

  final List<String> permissionIds;
  final int expectedVersion;

  factory ReplaceCustomRolePermissionsRequest.fromJson(Map<String, Object?> json) => ReplaceCustomRolePermissionsRequest(
    permissionIds: List<String>.from(json['permission_ids'] as List),
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'permission_ids': permissionIds,
    'expected_version': expectedVersion,
  };
}

class CustomRoleVersion {
  const CustomRoleVersion({
    required this.customRoleId,
    required this.version,
  });

  final String customRoleId;
  final int version;

  factory CustomRoleVersion.fromJson(Map<String, Object?> json) => CustomRoleVersion(
    customRoleId: json['custom_role_id'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'custom_role_id': customRoleId,
    'version': version,
  };
}

class AssignMembershipCustomRoleRequest {
  const AssignMembershipCustomRoleRequest({
    required this.customRoleId,
    required this.expectedVersion,
  });

  final String? customRoleId;
  final int expectedVersion;

  factory AssignMembershipCustomRoleRequest.fromJson(Map<String, Object?> json) => AssignMembershipCustomRoleRequest(
    customRoleId: json['custom_role_id'] == null ? null : json['custom_role_id'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'custom_role_id': customRoleId,
    'expected_version': expectedVersion,
  };
}

class MembershipCustomRoleAssigned {
  const MembershipCustomRoleAssigned({
    required this.membershipId,
    required this.customRoleId,
    required this.version,
  });

  final String membershipId;
  final String? customRoleId;
  final int version;

  factory MembershipCustomRoleAssigned.fromJson(Map<String, Object?> json) => MembershipCustomRoleAssigned(
    membershipId: json['membership_id'] as String,
    customRoleId: json['custom_role_id'] == null ? null : json['custom_role_id'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'membership_id': membershipId,
    'custom_role_id': customRoleId,
    'version': version,
  };
}

class OrganizationSettingVersion {
  const OrganizationSettingVersion({
    required this.version,
    required this.value,
    required this.updatedByMembershipId,
    required this.createdAt,
  });

  final int version;
  final Map<String, Object?> value;
  final String? updatedByMembershipId;
  final String createdAt;

  factory OrganizationSettingVersion.fromJson(Map<String, Object?> json) => OrganizationSettingVersion(
    version: (json['version'] as num).toInt(),
    value: Map<String, Object?>.from(json['value'] as Map),
    updatedByMembershipId: json['updated_by_membership_id'] == null ? null : json['updated_by_membership_id'] as String,
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'version': version,
    'value': value,
    'updated_by_membership_id': updatedByMembershipId,
    'created_at': createdAt,
  };
}

class OrganizationSettingVersionList {
  const OrganizationSettingVersionList({
    required this.settingKey,
    required this.data,
  });

  final String settingKey;
  final List<OrganizationSettingVersion> data;

  factory OrganizationSettingVersionList.fromJson(Map<String, Object?> json) => OrganizationSettingVersionList(
    settingKey: json['setting_key'] as String,
    data: (json['data'] as List).map((e) => OrganizationSettingVersion.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'setting_key': settingKey,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class PlatformMaintenanceState {
  const PlatformMaintenanceState({
    required this.enabled,
    required this.reasonCode,
    required this.startsAt,
    required this.version,
    required this.updatedAt,
  });

  final bool enabled;
  final String? reasonCode;
  final String? startsAt;
  final int version;
  final String updatedAt;

  factory PlatformMaintenanceState.fromJson(Map<String, Object?> json) => PlatformMaintenanceState(
    enabled: json['enabled'] as bool,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    startsAt: json['starts_at'] == null ? null : json['starts_at'] as String,
    version: (json['version'] as num).toInt(),
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'enabled': enabled,
    'reason_code': reasonCode,
    'starts_at': startsAt,
    'version': version,
    'updated_at': updatedAt,
  };
}

class UpdatePlatformMaintenanceRequest {
  const UpdatePlatformMaintenanceRequest({
    required this.enabled,
    required this.reasonCode,
    required this.startsAt,
    required this.expectedVersion,
  });

  final bool enabled;
  final String? reasonCode;
  final String? startsAt;
  final int expectedVersion;

  factory UpdatePlatformMaintenanceRequest.fromJson(Map<String, Object?> json) => UpdatePlatformMaintenanceRequest(
    enabled: json['enabled'] as bool,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    startsAt: json['starts_at'] == null ? null : json['starts_at'] as String,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'enabled': enabled,
    'reason_code': reasonCode,
    'starts_at': startsAt,
    'expected_version': expectedVersion,
  };
}

class PlatformMaintenanceUpdated {
  const PlatformMaintenanceUpdated({
    required this.enabled,
    required this.reasonCode,
    required this.startsAt,
    required this.version,
  });

  final bool enabled;
  final String? reasonCode;
  final String? startsAt;
  final int version;

  factory PlatformMaintenanceUpdated.fromJson(Map<String, Object?> json) => PlatformMaintenanceUpdated(
    enabled: json['enabled'] as bool,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    startsAt: json['starts_at'] == null ? null : json['starts_at'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'enabled': enabled,
    'reason_code': reasonCode,
    'starts_at': startsAt,
    'version': version,
  };
}

class ReplayDeadLetterRequest {
  const ReplayDeadLetterRequest({
    required this.reasonCode,
  });

  final String reasonCode;

  factory ReplayDeadLetterRequest.fromJson(Map<String, Object?> json) => ReplayDeadLetterRequest(
    reasonCode: json['reason_code'] as String,
  );

  Map<String, Object?> toJson() => {
    'reason_code': reasonCode,
  };
}

class DeadLetterReplayed {
  const DeadLetterReplayed({
    required this.eventId,
    required this.status,
    required this.replayed,
  });

  final String eventId;
  final String status;
  final bool replayed;

  factory DeadLetterReplayed.fromJson(Map<String, Object?> json) => DeadLetterReplayed(
    eventId: json['event_id'] as String,
    status: json['status'] as String,
    replayed: json['replayed'] as bool,
  );

  Map<String, Object?> toJson() => {
    'event_id': eventId,
    'status': status,
    'replayed': replayed,
  };
}

class SupportTicketSlaState {
  const SupportTicketSlaState({
    required this.firstResponseDueAt,
    required this.resolutionDueAt,
    required this.firstRespondedAt,
    required this.firstResponseBreached,
    required this.resolutionBreached,
  });

  final String firstResponseDueAt;
  final String resolutionDueAt;
  final String? firstRespondedAt;
  final bool firstResponseBreached;
  final bool resolutionBreached;

  factory SupportTicketSlaState.fromJson(Map<String, Object?> json) => SupportTicketSlaState(
    firstResponseDueAt: json['first_response_due_at'] as String,
    resolutionDueAt: json['resolution_due_at'] as String,
    firstRespondedAt: json['first_responded_at'] == null ? null : json['first_responded_at'] as String,
    firstResponseBreached: json['first_response_breached'] as bool,
    resolutionBreached: json['resolution_breached'] as bool,
  );

  Map<String, Object?> toJson() => {
    'first_response_due_at': firstResponseDueAt,
    'resolution_due_at': resolutionDueAt,
    'first_responded_at': firstRespondedAt,
    'first_response_breached': firstResponseBreached,
    'resolution_breached': resolutionBreached,
  };
}

class SupportTicketSummary {
  const SupportTicketSummary({
    required this.supportTicketId,
    required this.categoryCode,
    required this.subjectCode,
    required this.status,
    required this.priority,
    required this.requesterProfileId,
    required this.assignedMembershipId,
    required this.resolutionCode,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
    required this.sla,
  });

  final String supportTicketId;
  final String categoryCode;
  final String subjectCode;
  final String status;
  final String priority;
  final String requesterProfileId;
  final String? assignedMembershipId;
  final String? resolutionCode;
  final int version;
  final String createdAt;
  final String updatedAt;
  final SupportTicketSlaState sla;

  factory SupportTicketSummary.fromJson(Map<String, Object?> json) => SupportTicketSummary(
    supportTicketId: json['support_ticket_id'] as String,
    categoryCode: json['category_code'] as String,
    subjectCode: json['subject_code'] as String,
    status: json['status'] as String,
    priority: json['priority'] as String,
    requesterProfileId: json['requester_profile_id'] as String,
    assignedMembershipId: json['assigned_membership_id'] == null ? null : json['assigned_membership_id'] as String,
    resolutionCode: json['resolution_code'] == null ? null : json['resolution_code'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
    sla: SupportTicketSlaState.fromJson(json['sla'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'support_ticket_id': supportTicketId,
    'category_code': categoryCode,
    'subject_code': subjectCode,
    'status': status,
    'priority': priority,
    'requester_profile_id': requesterProfileId,
    'assigned_membership_id': assignedMembershipId,
    'resolution_code': resolutionCode,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
    'sla': sla.toJson(),
  };
}

class SupportTicketList {
  const SupportTicketList({
    required this.data,
  });

  final List<SupportTicketSummary> data;

  factory SupportTicketList.fromJson(Map<String, Object?> json) => SupportTicketList(
    data: (json['data'] as List).map((e) => SupportTicketSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class EmergencyEventSummary {
  const EmergencyEventSummary({
    required this.emergencyEventId,
    required this.siteId,
    required this.patientProfileId,
    required this.reportedByProfileId,
    required this.status,
    required this.triagePriority,
    required this.categoryCode,
    required this.reasonCode,
    required this.latitude,
    required this.longitude,
    required this.addressText,
    required this.version,
    required this.createdAt,
    required this.triagedAt,
    required this.dispatchedAt,
    required this.onSceneAt,
    required this.resolvedAt,
  });

  final String emergencyEventId;
  final String? siteId;
  final String patientProfileId;
  final String reportedByProfileId;
  final String status;
  final String triagePriority;
  final String categoryCode;
  final String? reasonCode;
  final String? latitude;
  final String? longitude;
  final String? addressText;
  final int version;
  final String createdAt;
  final String? triagedAt;
  final String? dispatchedAt;
  final String? onSceneAt;
  final String? resolvedAt;

  factory EmergencyEventSummary.fromJson(Map<String, Object?> json) => EmergencyEventSummary(
    emergencyEventId: json['emergency_event_id'] as String,
    siteId: json['site_id'] == null ? null : json['site_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    reportedByProfileId: json['reported_by_profile_id'] as String,
    status: json['status'] as String,
    triagePriority: json['triage_priority'] as String,
    categoryCode: json['category_code'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    latitude: json['latitude'] == null ? null : json['latitude'] as String,
    longitude: json['longitude'] == null ? null : json['longitude'] as String,
    addressText: json['address_text'] == null ? null : json['address_text'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    triagedAt: json['triaged_at'] == null ? null : json['triaged_at'] as String,
    dispatchedAt: json['dispatched_at'] == null ? null : json['dispatched_at'] as String,
    onSceneAt: json['on_scene_at'] == null ? null : json['on_scene_at'] as String,
    resolvedAt: json['resolved_at'] == null ? null : json['resolved_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'emergency_event_id': emergencyEventId,
    'site_id': siteId,
    'patient_profile_id': patientProfileId,
    'reported_by_profile_id': reportedByProfileId,
    'status': status,
    'triage_priority': triagePriority,
    'category_code': categoryCode,
    'reason_code': reasonCode,
    'latitude': latitude,
    'longitude': longitude,
    'address_text': addressText,
    'version': version,
    'created_at': createdAt,
    'triaged_at': triagedAt,
    'dispatched_at': dispatchedAt,
    'on_scene_at': onSceneAt,
    'resolved_at': resolvedAt,
  };
}

class EmergencyEventList {
  const EmergencyEventList({
    required this.data,
  });

  final List<EmergencyEventSummary> data;

  factory EmergencyEventList.fromJson(Map<String, Object?> json) => EmergencyEventList(
    data: (json['data'] as List).map((e) => EmergencyEventSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class PayoutRunSummary {
  const PayoutRunSummary({
    required this.payoutRunId,
    required this.periodStart,
    required this.periodEnd,
    required this.status,
    required this.preparedByMembershipId,
    required this.approvedByMembershipId,
    required this.reasonCode,
    required this.itemCount,
    required this.paidCount,
    required this.grossSen,
    required this.netSen,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final String payoutRunId;
  final String periodStart;
  final String periodEnd;
  final String status;
  final String preparedByMembershipId;
  final String? approvedByMembershipId;
  final String? reasonCode;
  final int itemCount;
  final int paidCount;
  final int grossSen;
  final int netSen;
  final int version;
  final String createdAt;
  final String updatedAt;

  factory PayoutRunSummary.fromJson(Map<String, Object?> json) => PayoutRunSummary(
    payoutRunId: json['payout_run_id'] as String,
    periodStart: json['period_start'] as String,
    periodEnd: json['period_end'] as String,
    status: json['status'] as String,
    preparedByMembershipId: json['prepared_by_membership_id'] as String,
    approvedByMembershipId: json['approved_by_membership_id'] == null ? null : json['approved_by_membership_id'] as String,
    reasonCode: json['reason_code'] == null ? null : json['reason_code'] as String,
    itemCount: (json['item_count'] as num).toInt(),
    paidCount: (json['paid_count'] as num).toInt(),
    grossSen: (json['gross_sen'] as num).toInt(),
    netSen: (json['net_sen'] as num).toInt(),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'payout_run_id': payoutRunId,
    'period_start': periodStart,
    'period_end': periodEnd,
    'status': status,
    'prepared_by_membership_id': preparedByMembershipId,
    'approved_by_membership_id': approvedByMembershipId,
    'reason_code': reasonCode,
    'item_count': itemCount,
    'paid_count': paidCount,
    'gross_sen': grossSen,
    'net_sen': netSen,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class PayoutRunList {
  const PayoutRunList({
    required this.currency,
    required this.data,
  });

  final String currency;
  final List<PayoutRunSummary> data;

  factory PayoutRunList.fromJson(Map<String, Object?> json) => PayoutRunList(
    currency: json['currency'] as String,
    data: (json['data'] as List).map((e) => PayoutRunSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'currency': currency,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class LedgerEntrySummary {
  const LedgerEntrySummary({
    required this.ledgerEntryId,
    required this.kind,
    required this.referenceType,
    required this.referenceId,
    required this.memoCode,
    required this.reversesEntryId,
    required this.amountSen,
    required this.postingCount,
    required this.balanced,
    required this.postedAt,
  });

  final String ledgerEntryId;
  final String kind;
  final String referenceType;
  final String referenceId;
  final String memoCode;
  final String? reversesEntryId;
  final int amountSen;
  final int postingCount;
  final bool balanced;
  final String postedAt;

  factory LedgerEntrySummary.fromJson(Map<String, Object?> json) => LedgerEntrySummary(
    ledgerEntryId: json['ledger_entry_id'] as String,
    kind: json['kind'] as String,
    referenceType: json['reference_type'] as String,
    referenceId: json['reference_id'] as String,
    memoCode: json['memo_code'] as String,
    reversesEntryId: json['reverses_entry_id'] == null ? null : json['reverses_entry_id'] as String,
    amountSen: (json['amount_sen'] as num).toInt(),
    postingCount: (json['posting_count'] as num).toInt(),
    balanced: json['balanced'] as bool,
    postedAt: json['posted_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'ledger_entry_id': ledgerEntryId,
    'kind': kind,
    'reference_type': referenceType,
    'reference_id': referenceId,
    'memo_code': memoCode,
    'reverses_entry_id': reversesEntryId,
    'amount_sen': amountSen,
    'posting_count': postingCount,
    'balanced': balanced,
    'posted_at': postedAt,
  };
}

class LedgerEntryList {
  const LedgerEntryList({
    required this.currency,
    required this.data,
  });

  final String currency;
  final List<LedgerEntrySummary> data;

  factory LedgerEntryList.fromJson(Map<String, Object?> json) => LedgerEntryList(
    currency: json['currency'] as String,
    data: (json['data'] as List).map((e) => LedgerEntrySummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'currency': currency,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class PurchaseOrderSummary {
  const PurchaseOrderSummary({
    required this.purchaseOrderId,
    required this.siteId,
    required this.supplierId,
    required this.status,
    required this.lineCount,
    required this.orderedQuantity,
    required this.receivedQuantity,
    required this.outstandingQuantity,
    required this.orderedTotalSen,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final String purchaseOrderId;
  final String siteId;
  final String supplierId;
  final String status;
  final int lineCount;
  final int orderedQuantity;
  final int receivedQuantity;
  final int outstandingQuantity;
  final int orderedTotalSen;
  final int version;
  final String createdAt;
  final String updatedAt;

  factory PurchaseOrderSummary.fromJson(Map<String, Object?> json) => PurchaseOrderSummary(
    purchaseOrderId: json['purchase_order_id'] as String,
    siteId: json['site_id'] as String,
    supplierId: json['supplier_id'] as String,
    status: json['status'] as String,
    lineCount: (json['line_count'] as num).toInt(),
    orderedQuantity: (json['ordered_quantity'] as num).toInt(),
    receivedQuantity: (json['received_quantity'] as num).toInt(),
    outstandingQuantity: (json['outstanding_quantity'] as num).toInt(),
    orderedTotalSen: (json['ordered_total_sen'] as num).toInt(),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'purchase_order_id': purchaseOrderId,
    'site_id': siteId,
    'supplier_id': supplierId,
    'status': status,
    'line_count': lineCount,
    'ordered_quantity': orderedQuantity,
    'received_quantity': receivedQuantity,
    'outstanding_quantity': outstandingQuantity,
    'ordered_total_sen': orderedTotalSen,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class PurchaseOrderList {
  const PurchaseOrderList({
    required this.currency,
    required this.data,
  });

  final String currency;
  final List<PurchaseOrderSummary> data;

  factory PurchaseOrderList.fromJson(Map<String, Object?> json) => PurchaseOrderList(
    currency: json['currency'] as String,
    data: (json['data'] as List).map((e) => PurchaseOrderSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'currency': currency,
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class StockReturnSummary {
  const StockReturnSummary({
    required this.returnId,
    required this.siteId,
    required this.pharmacyOrderId,
    required this.status,
    required this.reasonCode,
    required this.lineCount,
    required this.totalQuantity,
    required this.postedLineCount,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final String returnId;
  final String siteId;
  final String? pharmacyOrderId;
  final String status;
  final String reasonCode;
  final int lineCount;
  final int totalQuantity;
  final int postedLineCount;
  final int version;
  final String createdAt;
  final String updatedAt;

  factory StockReturnSummary.fromJson(Map<String, Object?> json) => StockReturnSummary(
    returnId: json['return_id'] as String,
    siteId: json['site_id'] as String,
    pharmacyOrderId: json['pharmacy_order_id'] == null ? null : json['pharmacy_order_id'] as String,
    status: json['status'] as String,
    reasonCode: json['reason_code'] as String,
    lineCount: (json['line_count'] as num).toInt(),
    totalQuantity: (json['total_quantity'] as num).toInt(),
    postedLineCount: (json['posted_line_count'] as num).toInt(),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'return_id': returnId,
    'site_id': siteId,
    'pharmacy_order_id': pharmacyOrderId,
    'status': status,
    'reason_code': reasonCode,
    'line_count': lineCount,
    'total_quantity': totalQuantity,
    'posted_line_count': postedLineCount,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class StockReturnList {
  const StockReturnList({
    required this.data,
  });

  final List<StockReturnSummary> data;

  factory StockReturnList.fromJson(Map<String, Object?> json) => StockReturnList(
    data: (json['data'] as List).map((e) => StockReturnSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class StockReconciliationSummary {
  const StockReconciliationSummary({
    required this.reconciliationId,
    required this.siteId,
    required this.status,
    required this.countedByProfileId,
    required this.approvedByProfileId,
    required this.lineCount,
    required this.varianceQuantity,
    required this.absoluteVarianceQuantity,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final String reconciliationId;
  final String siteId;
  final String status;
  final String countedByProfileId;
  final String? approvedByProfileId;
  final int lineCount;
  final int varianceQuantity;
  final int absoluteVarianceQuantity;
  final int version;
  final String createdAt;
  final String updatedAt;

  factory StockReconciliationSummary.fromJson(Map<String, Object?> json) => StockReconciliationSummary(
    reconciliationId: json['reconciliation_id'] as String,
    siteId: json['site_id'] as String,
    status: json['status'] as String,
    countedByProfileId: json['counted_by_profile_id'] as String,
    approvedByProfileId: json['approved_by_profile_id'] == null ? null : json['approved_by_profile_id'] as String,
    lineCount: (json['line_count'] as num).toInt(),
    varianceQuantity: (json['variance_quantity'] as num).toInt(),
    absoluteVarianceQuantity: (json['absolute_variance_quantity'] as num).toInt(),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'reconciliation_id': reconciliationId,
    'site_id': siteId,
    'status': status,
    'counted_by_profile_id': countedByProfileId,
    'approved_by_profile_id': approvedByProfileId,
    'line_count': lineCount,
    'variance_quantity': varianceQuantity,
    'absolute_variance_quantity': absoluteVarianceQuantity,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class StockReconciliationList {
  const StockReconciliationList({
    required this.data,
  });

  final List<StockReconciliationSummary> data;

  factory StockReconciliationList.fromJson(Map<String, Object?> json) => StockReconciliationList(
    data: (json['data'] as List).map((e) => StockReconciliationSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

class AdminAppointmentMetrics {
  const AdminAppointmentMetrics({
    required this.total,
    required this.startingWithin24h,
    required this.active,
  });

  final int total;
  final int startingWithin24h;
  final int active;

  factory AdminAppointmentMetrics.fromJson(Map<String, Object?> json) => AdminAppointmentMetrics(
    total: (json['total'] as num).toInt(),
    startingWithin24h: (json['starting_within_24h'] as num).toInt(),
    active: (json['active'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'total': total,
    'starting_within_24h': startingWithin24h,
    'active': active,
  };
}

class AdminEmergencyMetrics {
  const AdminEmergencyMetrics({
    required this.active,
  });

  final int active;

  factory AdminEmergencyMetrics.fromJson(Map<String, Object?> json) => AdminEmergencyMetrics(
    active: (json['active'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'active': active,
  };
}

class AdminSupportMetrics {
  const AdminSupportMetrics({
    required this.open,
    required this.breachingResolution,
  });

  final int open;
  final int breachingResolution;

  factory AdminSupportMetrics.fromJson(Map<String, Object?> json) => AdminSupportMetrics(
    open: (json['open'] as num).toInt(),
    breachingResolution: (json['breaching_resolution'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'open': open,
    'breaching_resolution': breachingResolution,
  };
}

class AdminDoctorMetrics {
  const AdminDoctorMetrics({
    required this.listed,
    required this.acceptingNewPatients,
  });

  final int listed;
  final int acceptingNewPatients;

  factory AdminDoctorMetrics.fromJson(Map<String, Object?> json) => AdminDoctorMetrics(
    listed: (json['listed'] as num).toInt(),
    acceptingNewPatients: (json['accepting_new_patients'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'listed': listed,
    'accepting_new_patients': acceptingNewPatients,
  };
}

class AdminRevenueMetrics {
  const AdminRevenueMetrics({
    required this.capturedSen,
    required this.currency,
    required this.periodStart,
  });

  final int capturedSen;
  final String currency;
  final Timestamp periodStart;

  factory AdminRevenueMetrics.fromJson(Map<String, Object?> json) => AdminRevenueMetrics(
    capturedSen: (json['captured_sen'] as num).toInt(),
    currency: json['currency'] as String,
    periodStart: json['period_start'] as String,
  );

  Map<String, Object?> toJson() => {
    'captured_sen': capturedSen,
    'currency': currency,
    'period_start': periodStart,
  };
}

class AdminMetricsGroups {
  const AdminMetricsGroups({
    this.appointments,
    this.emergencies,
    this.support,
    this.doctors,
    this.revenue,
  });

  final AdminAppointmentMetrics? appointments;
  final AdminEmergencyMetrics? emergencies;
  final AdminSupportMetrics? support;
  final AdminDoctorMetrics? doctors;
  final AdminRevenueMetrics? revenue;

  factory AdminMetricsGroups.fromJson(Map<String, Object?> json) => AdminMetricsGroups(
    appointments: json['appointments'] == null ? null : AdminAppointmentMetrics.fromJson(json['appointments'] as Map<String, Object?>),
    emergencies: json['emergencies'] == null ? null : AdminEmergencyMetrics.fromJson(json['emergencies'] as Map<String, Object?>),
    support: json['support'] == null ? null : AdminSupportMetrics.fromJson(json['support'] as Map<String, Object?>),
    doctors: json['doctors'] == null ? null : AdminDoctorMetrics.fromJson(json['doctors'] as Map<String, Object?>),
    revenue: json['revenue'] == null ? null : AdminRevenueMetrics.fromJson(json['revenue'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'appointments': appointments?.toJson(),
    'emergencies': emergencies?.toJson(),
    'support': support?.toJson(),
    'doctors': doctors?.toJson(),
    'revenue': revenue?.toJson(),
  };
}

class AdminMetricsResponse {
  const AdminMetricsResponse({
    required this.data,
    required this.readableGroups,
  });

  final AdminMetricsGroups data;
  final List<String> readableGroups;

  factory AdminMetricsResponse.fromJson(Map<String, Object?> json) => AdminMetricsResponse(
    data: AdminMetricsGroups.fromJson(json['data'] as Map<String, Object?>),
    readableGroups: List<String>.from(json['readable_groups'] as List),
  );

  Map<String, Object?> toJson() => {
    'data': data.toJson(),
    'readable_groups': readableGroups,
  };
}

class DoctorAssignedPatient {
  const DoctorAssignedPatient({
    required this.profileId,
    required this.displayName,
    required this.email,
    required this.phoneE164,
    required this.preferredLocale,
    required this.timezone,
    required this.status,
    required this.assignedAt,
  });

  final String profileId;
  final String displayName;
  final String email;
  final String? phoneE164;
  final String preferredLocale;
  final String timezone;
  final String status;
  final String assignedAt;

  factory DoctorAssignedPatient.fromJson(Map<String, Object?> json) => DoctorAssignedPatient(
    profileId: json['profile_id'] as String,
    displayName: json['display_name'] as String,
    email: json['email'] as String,
    phoneE164: json['phone_e164'] == null ? null : json['phone_e164'] as String,
    preferredLocale: json['preferred_locale'] as String,
    timezone: json['timezone'] as String,
    status: json['status'] as String,
    assignedAt: json['assigned_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'profile_id': profileId,
    'display_name': displayName,
    'email': email,
    'phone_e164': phoneE164,
    'preferred_locale': preferredLocale,
    'timezone': timezone,
    'status': status,
    'assigned_at': assignedAt,
  };
}

class PrescriptionList {
  const PrescriptionList({
    required this.data,
    required this.page,
  });

  final List<Prescription> data;
  final PageInfo page;

  factory PrescriptionList.fromJson(Map<String, Object?> json) => PrescriptionList(
    data: (json['data'] as List).map((e) => Prescription.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class ConversationInbox {
  const ConversationInbox({
    required this.conversationId,
    required this.consultationId,
    required this.patientProfileId,
    required this.status,
    required this.latestMessageId,
    required this.latestMessageAt,
    required this.updatedAt,
    required this.unreadCount,
  });

  final UuidV7 conversationId;
  final UuidV7 consultationId;
  final UuidV7 patientProfileId;
  final String status;
  final UuidV7 latestMessageId;
  final Timestamp latestMessageAt;
  final Timestamp updatedAt;
  final int unreadCount;

  factory ConversationInbox.fromJson(Map<String, Object?> json) => ConversationInbox(
    conversationId: json['conversation_id'] as String,
    consultationId: json['consultation_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    status: json['status'] as String,
    latestMessageId: json['latest_message_id'] as String,
    latestMessageAt: json['latest_message_at'] as String,
    updatedAt: json['updated_at'] as String,
    unreadCount: (json['unread_count'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'conversation_id': conversationId,
    'consultation_id': consultationId,
    'patient_profile_id': patientProfileId,
    'status': status,
    'latest_message_id': latestMessageId,
    'latest_message_at': latestMessageAt,
    'updated_at': updatedAt,
    'unread_count': unreadCount,
  };
}

class ConversationInboxList {
  const ConversationInboxList({
    required this.data,
    required this.page,
  });

  final List<ConversationInbox> data;
  final PageInfo page;

  factory ConversationInboxList.fromJson(Map<String, Object?> json) => ConversationInboxList(
    data: (json['data'] as List).map((e) => ConversationInbox.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class DoctorNoteList {
  const DoctorNoteList({
    required this.data,
    required this.page,
  });

  final List<ClinicalNote> data;
  final PageInfo page;

  factory DoctorNoteList.fromJson(Map<String, Object?> json) => DoctorNoteList(
    data: (json['data'] as List).map((e) => ClinicalNote.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class AiArtifactList {
  const AiArtifactList({
    required this.data,
    required this.page,
  });

  final List<AiArtifact> data;
  final PageInfo page;

  factory AiArtifactList.fromJson(Map<String, Object?> json) => AiArtifactList(
    data: (json['data'] as List).map((e) => AiArtifact.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class DoctorDevice {
  const DoctorDevice({
    required this.id,
    required this.serialNumber,
    required this.deviceType,
    required this.state,
    required this.lastSeenAt,
    required this.patientProfileId,
    required this.version,
  });

  final UuidV7 id;
  final String serialNumber;
  final DeviceType deviceType;
  final DeviceState state;
  final Timestamp? lastSeenAt;
  final UuidV7 patientProfileId;
  final int version;

  factory DoctorDevice.fromJson(Map<String, Object?> json) => DoctorDevice(
    id: json['id'] as String,
    serialNumber: json['serial_number'] as String,
    deviceType: deviceTypeFromWire(json['device_type'] as String),
    state: deviceStateFromWire(json['state'] as String),
    lastSeenAt: json['last_seen_at'] == null ? null : json['last_seen_at'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    version: (json['version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'serial_number': serialNumber,
    'device_type': deviceType.wireValue,
    'state': state.wireValue,
    'last_seen_at': lastSeenAt,
    'patient_profile_id': patientProfileId,
    'version': version,
  };
}

class DoctorDeviceList {
  const DoctorDeviceList({
    required this.data,
    required this.page,
  });

  final List<DoctorDevice> data;
  final PageInfo page;

  factory DoctorDeviceList.fromJson(Map<String, Object?> json) => DoctorDeviceList(
    data: (json['data'] as List).map((e) => DoctorDevice.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

enum PayoutItemStatus {
  pending,
  paid,
  failed,
  cancelled,
  unknown,
}

extension PayoutItemStatusWire on PayoutItemStatus {
  String get wireValue => switch (this) {
    PayoutItemStatus.pending => 'pending',
    PayoutItemStatus.paid => 'paid',
    PayoutItemStatus.failed => 'failed',
    PayoutItemStatus.cancelled => 'cancelled',
    PayoutItemStatus.unknown => throw StateError('Cannot serialize unknown PayoutItemStatus'),
  };
}

PayoutItemStatus payoutItemStatusFromWire(String value) => switch (value) {
  'pending' => PayoutItemStatus.pending,
  'paid' => PayoutItemStatus.paid,
  'failed' => PayoutItemStatus.failed,
  'cancelled' => PayoutItemStatus.cancelled,
  _ => PayoutItemStatus.unknown,
};

enum PayoutRunStatus {
  draft,
  approved,
  processing,
  completed,
  partiallyFailed,
  failed,
  cancelled,
  unknown,
}

extension PayoutRunStatusWire on PayoutRunStatus {
  String get wireValue => switch (this) {
    PayoutRunStatus.draft => 'draft',
    PayoutRunStatus.approved => 'approved',
    PayoutRunStatus.processing => 'processing',
    PayoutRunStatus.completed => 'completed',
    PayoutRunStatus.partiallyFailed => 'partially_failed',
    PayoutRunStatus.failed => 'failed',
    PayoutRunStatus.cancelled => 'cancelled',
    PayoutRunStatus.unknown => throw StateError('Cannot serialize unknown PayoutRunStatus'),
  };
}

PayoutRunStatus payoutRunStatusFromWire(String value) => switch (value) {
  'draft' => PayoutRunStatus.draft,
  'approved' => PayoutRunStatus.approved,
  'processing' => PayoutRunStatus.processing,
  'completed' => PayoutRunStatus.completed,
  'partially_failed' => PayoutRunStatus.partiallyFailed,
  'failed' => PayoutRunStatus.failed,
  'cancelled' => PayoutRunStatus.cancelled,
  _ => PayoutRunStatus.unknown,
};

class DoctorPayoutItem {
  const DoctorPayoutItem({
    required this.id,
    required this.payoutRunId,
    required this.grossSen,
    required this.platformFeeSen,
    required this.netSen,
    required this.status,
    required this.ledgerEntryId,
    required this.periodStart,
    required this.periodEnd,
    required this.runStatus,
    required this.createdAt,
  });

  final UuidV7 id;
  final UuidV7 payoutRunId;
  final int grossSen;
  final int platformFeeSen;
  final int netSen;
  final PayoutItemStatus status;
  final UuidV7? ledgerEntryId;
  final String periodStart;
  final String periodEnd;
  final PayoutRunStatus runStatus;
  final Timestamp createdAt;

  factory DoctorPayoutItem.fromJson(Map<String, Object?> json) => DoctorPayoutItem(
    id: json['id'] as String,
    payoutRunId: json['payout_run_id'] as String,
    grossSen: (json['gross_sen'] as num).toInt(),
    platformFeeSen: (json['platform_fee_sen'] as num).toInt(),
    netSen: (json['net_sen'] as num).toInt(),
    status: payoutItemStatusFromWire(json['status'] as String),
    ledgerEntryId: json['ledger_entry_id'] == null ? null : json['ledger_entry_id'] as String,
    periodStart: json['period_start'] as String,
    periodEnd: json['period_end'] as String,
    runStatus: payoutRunStatusFromWire(json['run_status'] as String),
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'payout_run_id': payoutRunId,
    'gross_sen': grossSen,
    'platform_fee_sen': platformFeeSen,
    'net_sen': netSen,
    'status': status.wireValue,
    'ledger_entry_id': ledgerEntryId,
    'period_start': periodStart,
    'period_end': periodEnd,
    'run_status': runStatus.wireValue,
    'created_at': createdAt,
  };
}

class DoctorEarnings {
  const DoctorEarnings({
    required this.balanceSen,
    required this.currency,
    required this.totalEarnedSen,
    required this.data,
    required this.page,
  });

  final int balanceSen;
  final String currency;
  final int totalEarnedSen;
  final List<DoctorPayoutItem> data;
  final PageInfo page;

  factory DoctorEarnings.fromJson(Map<String, Object?> json) => DoctorEarnings(
    balanceSen: (json['balance_sen'] as num).toInt(),
    currency: json['currency'] as String,
    totalEarnedSen: (json['total_earned_sen'] as num).toInt(),
    data: (json['data'] as List).map((e) => DoctorPayoutItem.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'balance_sen': balanceSen,
    'currency': currency,
    'total_earned_sen': totalEarnedSen,
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

enum ClinicalTemplateStatus {
  active,
  archived,
  unknown,
}

extension ClinicalTemplateStatusWire on ClinicalTemplateStatus {
  String get wireValue => switch (this) {
    ClinicalTemplateStatus.active => 'active',
    ClinicalTemplateStatus.archived => 'archived',
    ClinicalTemplateStatus.unknown => throw StateError('Cannot serialize unknown ClinicalTemplateStatus'),
  };
}

ClinicalTemplateStatus clinicalTemplateStatusFromWire(String value) => switch (value) {
  'active' => ClinicalTemplateStatus.active,
  'archived' => ClinicalTemplateStatus.archived,
  _ => ClinicalTemplateStatus.unknown,
};

typedef ClinicalTemplateContent = Map<String, Object?>;

class ClinicalTemplate {
  const ClinicalTemplate({
    required this.templateId,
    required this.authorMembershipId,
    required this.organizationId,
    required this.name,
    required this.description,
    required this.specialty,
    required this.content,
    required this.status,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 templateId;
  final UuidV7 authorMembershipId;
  final UuidV7 organizationId;
  final String name;
  final String? description;
  final String? specialty;
  final ClinicalTemplateContent content;
  final ClinicalTemplateStatus status;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory ClinicalTemplate.fromJson(Map<String, Object?> json) => ClinicalTemplate(
    templateId: json['template_id'] as String,
    authorMembershipId: json['author_membership_id'] as String,
    organizationId: json['organization_id'] as String,
    name: json['name'] as String,
    description: json['description'] == null ? null : json['description'] as String,
    specialty: json['specialty'] == null ? null : json['specialty'] as String,
    content: json['content'] as Map<String, Object?>,
    status: clinicalTemplateStatusFromWire(json['status'] as String),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'template_id': templateId,
    'author_membership_id': authorMembershipId,
    'organization_id': organizationId,
    'name': name,
    'description': description,
    'specialty': specialty,
    'content': content,
    'status': status.wireValue,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class ClinicalTemplateCreateRequest {
  const ClinicalTemplateCreateRequest({
    required this.name,
    required this.description,
    required this.specialty,
    required this.content,
  });

  final String name;
  final String? description;
  final String? specialty;
  final ClinicalTemplateContent content;

  factory ClinicalTemplateCreateRequest.fromJson(Map<String, Object?> json) => ClinicalTemplateCreateRequest(
    name: json['name'] as String,
    description: json['description'] == null ? null : json['description'] as String,
    specialty: json['specialty'] == null ? null : json['specialty'] as String,
    content: json['content'] as Map<String, Object?>,
  );

  Map<String, Object?> toJson() => {
    'name': name,
    'description': description,
    'specialty': specialty,
    'content': content,
  };
}

class ClinicalTemplateUpdateRequest {
  const ClinicalTemplateUpdateRequest({
    required this.name,
    required this.description,
    required this.specialty,
    required this.content,
    required this.expectedVersion,
  });

  final String name;
  final String? description;
  final String? specialty;
  final ClinicalTemplateContent content;
  final int expectedVersion;

  factory ClinicalTemplateUpdateRequest.fromJson(Map<String, Object?> json) => ClinicalTemplateUpdateRequest(
    name: json['name'] as String,
    description: json['description'] == null ? null : json['description'] as String,
    specialty: json['specialty'] == null ? null : json['specialty'] as String,
    content: json['content'] as Map<String, Object?>,
    expectedVersion: (json['expected_version'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'name': name,
    'description': description,
    'specialty': specialty,
    'content': content,
    'expected_version': expectedVersion,
  };
}

class ClinicalTemplateList {
  const ClinicalTemplateList({
    required this.data,
    required this.page,
  });

  final List<ClinicalTemplate> data;
  final PageInfo page;

  factory ClinicalTemplateList.fromJson(Map<String, Object?> json) => ClinicalTemplateList(
    data: (json['data'] as List).map((e) => ClinicalTemplate.fromJson(e as Map<String, Object?>)).toList(),
    page: PageInfo.fromJson(json['page'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
    'page': page.toJson(),
  };
}

class DoctorAiAssistantRequest {
  const DoctorAiAssistantRequest({
    this.patientProfileId,
    this.consultationId,
    required this.prompt,
  });

  final UuidV7? patientProfileId;
  final UuidV7? consultationId;
  final String prompt;

  factory DoctorAiAssistantRequest.fromJson(Map<String, Object?> json) => DoctorAiAssistantRequest(
    patientProfileId: json['patient_profile_id'] == null ? null : json['patient_profile_id'] as String,
    consultationId: json['consultation_id'] == null ? null : json['consultation_id'] as String,
    prompt: json['prompt'] as String,
  );

  Map<String, Object?> toJson() => {
    'patient_profile_id': patientProfileId,
    'consultation_id': consultationId,
    'prompt': prompt,
  };
}

class DoctorAiAssistantResponse {
  const DoctorAiAssistantResponse({
    required this.response,
    required this.provider,
    required this.model,
    required this.patientProfileId,
    required this.consultationId,
    required this.promptTokens,
    required this.completionTokens,
    required this.latencyMs,
    required this.correlationId,
  });

  final String response;
  final String provider;
  final String model;
  final UuidV7? patientProfileId;
  final UuidV7? consultationId;
  final int promptTokens;
  final int completionTokens;
  final int latencyMs;
  final UuidV7 correlationId;

  factory DoctorAiAssistantResponse.fromJson(Map<String, Object?> json) => DoctorAiAssistantResponse(
    response: json['response'] as String,
    provider: json['provider'] as String,
    model: json['model'] as String,
    patientProfileId: json['patient_profile_id'] == null ? null : json['patient_profile_id'] as String,
    consultationId: json['consultation_id'] == null ? null : json['consultation_id'] as String,
    promptTokens: (json['prompt_tokens'] as num).toInt(),
    completionTokens: (json['completion_tokens'] as num).toInt(),
    latencyMs: (json['latency_ms'] as num).toInt(),
    correlationId: json['correlation_id'] as String,
  );

  Map<String, Object?> toJson() => {
    'response': response,
    'provider': provider,
    'model': model,
    'patient_profile_id': patientProfileId,
    'consultation_id': consultationId,
    'prompt_tokens': promptTokens,
    'completion_tokens': completionTokens,
    'latency_ms': latencyMs,
    'correlation_id': correlationId,
  };
}

class DoctorUpcomingAppointment {
  const DoctorUpcomingAppointment({
    required this.appointmentId,
    required this.patientProfileId,
    required this.startsAt,
    required this.status,
    required this.mode,
  });

  final UuidV7 appointmentId;
  final UuidV7 patientProfileId;
  final Timestamp startsAt;
  final String status;
  final String mode;

  factory DoctorUpcomingAppointment.fromJson(Map<String, Object?> json) => DoctorUpcomingAppointment(
    appointmentId: json['appointment_id'] as String,
    patientProfileId: json['patient_profile_id'] as String,
    startsAt: json['starts_at'] as String,
    status: json['status'] as String,
    mode: json['mode'] as String,
  );

  Map<String, Object?> toJson() => {
    'appointment_id': appointmentId,
    'patient_profile_id': patientProfileId,
    'starts_at': startsAt,
    'status': status,
    'mode': mode,
  };
}

class DoctorDashboardGroups {
  const DoctorDashboardGroups({
    this.todayAppointments,
    this.upcomingAppointments,
    this.assignedPatients,
    this.pendingNotes,
    this.unreadNotifications,
    this.activeIotAlerts,
  });

  final int? todayAppointments;
  final List<DoctorUpcomingAppointment>? upcomingAppointments;
  final int? assignedPatients;
  final int? pendingNotes;
  final int? unreadNotifications;
  final int? activeIotAlerts;

  factory DoctorDashboardGroups.fromJson(Map<String, Object?> json) => DoctorDashboardGroups(
    todayAppointments: json['today_appointments'] == null ? null : (json['today_appointments'] as num).toInt(),
    upcomingAppointments: json['upcoming_appointments'] == null ? null : (json['upcoming_appointments'] as List).map((e) => DoctorUpcomingAppointment.fromJson(e as Map<String, Object?>)).toList(),
    assignedPatients: json['assigned_patients'] == null ? null : (json['assigned_patients'] as num).toInt(),
    pendingNotes: json['pending_notes'] == null ? null : (json['pending_notes'] as num).toInt(),
    unreadNotifications: json['unread_notifications'] == null ? null : (json['unread_notifications'] as num).toInt(),
    activeIotAlerts: json['active_iot_alerts'] == null ? null : (json['active_iot_alerts'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'today_appointments': todayAppointments,
    'upcoming_appointments': upcomingAppointments?.map((e) => e.toJson()).toList(),
    'assigned_patients': assignedPatients,
    'pending_notes': pendingNotes,
    'unread_notifications': unreadNotifications,
    'active_iot_alerts': activeIotAlerts,
  };
}

class DoctorDashboardResponse {
  const DoctorDashboardResponse({
    required this.data,
    required this.readableGroups,
  });

  final DoctorDashboardGroups data;
  final List<String> readableGroups;

  factory DoctorDashboardResponse.fromJson(Map<String, Object?> json) => DoctorDashboardResponse(
    data: DoctorDashboardGroups.fromJson(json['data'] as Map<String, Object?>),
    readableGroups: List<String>.from(json['readable_groups'] as List),
  );

  Map<String, Object?> toJson() => {
    'data': data.toJson(),
    'readable_groups': readableGroups,
  };
}

class AppointmentStatusCount {
  const AppointmentStatusCount({
    required this.status,
    required this.count,
  });

  final String status;
  final int count;

  factory AppointmentStatusCount.fromJson(Map<String, Object?> json) => AppointmentStatusCount(
    status: json['status'] as String,
    count: (json['count'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'status': status,
    'count': count,
  };
}

class PatientCountPoint {
  const PatientCountPoint({
    required this.periodStart,
    required this.periodEnd,
    required this.count,
  });

  final Timestamp periodStart;
  final Timestamp periodEnd;
  final int count;

  factory PatientCountPoint.fromJson(Map<String, Object?> json) => PatientCountPoint(
    periodStart: json['period_start'] as String,
    periodEnd: json['period_end'] as String,
    count: (json['count'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'period_start': periodStart,
    'period_end': periodEnd,
    'count': count,
  };
}

class DoctorRatingSummary {
  const DoctorRatingSummary({
    required this.ratingAverage,
    required this.reviewCount,
  });

  final double ratingAverage;
  final int reviewCount;

  factory DoctorRatingSummary.fromJson(Map<String, Object?> json) => DoctorRatingSummary(
    ratingAverage: (json['rating_average'] as num).toDouble(),
    reviewCount: (json['review_count'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'rating_average': ratingAverage,
    'review_count': reviewCount,
  };
}

class DoctorMonthlyEarningsProjection {
  const DoctorMonthlyEarningsProjection({
    required this.projectedSen,
    required this.currency,
    required this.periodStart,
    required this.basisCount,
  });

  final int projectedSen;
  final String currency;
  final Timestamp periodStart;
  final int basisCount;

  factory DoctorMonthlyEarningsProjection.fromJson(Map<String, Object?> json) => DoctorMonthlyEarningsProjection(
    projectedSen: (json['projected_sen'] as num).toInt(),
    currency: json['currency'] as String,
    periodStart: json['period_start'] as String,
    basisCount: (json['basis_count'] as num).toInt(),
  );

  Map<String, Object?> toJson() => {
    'projected_sen': projectedSen,
    'currency': currency,
    'period_start': periodStart,
    'basis_count': basisCount,
  };
}

class DoctorAnalyticsGroups {
  const DoctorAnalyticsGroups({
    this.appointmentStatusBreakdown,
    this.patientCountTrend,
    this.ratingSummary,
    this.monthlyEarningsProjection,
  });

  final List<AppointmentStatusCount>? appointmentStatusBreakdown;
  final List<PatientCountPoint>? patientCountTrend;
  final DoctorRatingSummary? ratingSummary;
  final DoctorMonthlyEarningsProjection? monthlyEarningsProjection;

  factory DoctorAnalyticsGroups.fromJson(Map<String, Object?> json) => DoctorAnalyticsGroups(
    appointmentStatusBreakdown: json['appointment_status_breakdown'] == null ? null : (json['appointment_status_breakdown'] as List).map((e) => AppointmentStatusCount.fromJson(e as Map<String, Object?>)).toList(),
    patientCountTrend: json['patient_count_trend'] == null ? null : (json['patient_count_trend'] as List).map((e) => PatientCountPoint.fromJson(e as Map<String, Object?>)).toList(),
    ratingSummary: json['rating_summary'] == null ? null : DoctorRatingSummary.fromJson(json['rating_summary'] as Map<String, Object?>),
    monthlyEarningsProjection: json['monthly_earnings_projection'] == null ? null : DoctorMonthlyEarningsProjection.fromJson(json['monthly_earnings_projection'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'appointment_status_breakdown': appointmentStatusBreakdown?.map((e) => e.toJson()).toList(),
    'patient_count_trend': patientCountTrend?.map((e) => e.toJson()).toList(),
    'rating_summary': ratingSummary?.toJson(),
    'monthly_earnings_projection': monthlyEarningsProjection?.toJson(),
  };
}

class DoctorAnalyticsResponse {
  const DoctorAnalyticsResponse({
    required this.data,
    required this.readableGroups,
  });

  final DoctorAnalyticsGroups data;
  final List<String> readableGroups;

  factory DoctorAnalyticsResponse.fromJson(Map<String, Object?> json) => DoctorAnalyticsResponse(
    data: DoctorAnalyticsGroups.fromJson(json['data'] as Map<String, Object?>),
    readableGroups: List<String>.from(json['readable_groups'] as List),
  );

  Map<String, Object?> toJson() => {
    'data': data.toJson(),
    'readable_groups': readableGroups,
  };
}

enum EmergencyUnitStatus {
  available,
  reserved,
  enRoute,
  onScene,
  transporting,
  outOfService,
  unknown,
}

extension EmergencyUnitStatusWire on EmergencyUnitStatus {
  String get wireValue => switch (this) {
    EmergencyUnitStatus.available => 'available',
    EmergencyUnitStatus.reserved => 'reserved',
    EmergencyUnitStatus.enRoute => 'en_route',
    EmergencyUnitStatus.onScene => 'on_scene',
    EmergencyUnitStatus.transporting => 'transporting',
    EmergencyUnitStatus.outOfService => 'out_of_service',
    EmergencyUnitStatus.unknown => throw StateError('Cannot serialize unknown EmergencyUnitStatus'),
  };
}

EmergencyUnitStatus emergencyUnitStatusFromWire(String value) => switch (value) {
  'available' => EmergencyUnitStatus.available,
  'reserved' => EmergencyUnitStatus.reserved,
  'en_route' => EmergencyUnitStatus.enRoute,
  'on_scene' => EmergencyUnitStatus.onScene,
  'transporting' => EmergencyUnitStatus.transporting,
  'out_of_service' => EmergencyUnitStatus.outOfService,
  _ => EmergencyUnitStatus.unknown,
};

class EmergencyUnitSummary {
  const EmergencyUnitSummary({
    required this.emergencyUnitId,
    required this.organizationId,
    required this.siteId,
    required this.callSign,
    required this.unitType,
    required this.status,
    required this.capacity,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final String emergencyUnitId;
  final String organizationId;
  final String siteId;
  final String callSign;
  final String unitType;
  final EmergencyUnitStatus status;
  final int capacity;
  final int version;
  final String createdAt;
  final String updatedAt;

  factory EmergencyUnitSummary.fromJson(Map<String, Object?> json) => EmergencyUnitSummary(
    emergencyUnitId: json['emergency_unit_id'] as String,
    organizationId: json['organization_id'] as String,
    siteId: json['site_id'] as String,
    callSign: json['call_sign'] as String,
    unitType: json['unit_type'] as String,
    status: emergencyUnitStatusFromWire(json['status'] as String),
    capacity: (json['capacity'] as num).toInt(),
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'emergency_unit_id': emergencyUnitId,
    'organization_id': organizationId,
    'site_id': siteId,
    'call_sign': callSign,
    'unit_type': unitType,
    'status': status.wireValue,
    'capacity': capacity,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class EmergencyUnitList {
  const EmergencyUnitList({
    required this.data,
  });

  final List<EmergencyUnitSummary> data;

  factory EmergencyUnitList.fromJson(Map<String, Object?> json) => EmergencyUnitList(
    data: (json['data'] as List).map((e) => EmergencyUnitSummary.fromJson(e as Map<String, Object?>)).toList(),
  );

  Map<String, Object?> toJson() => {
    'data': data.map((e) => e.toJson()).toList(),
  };
}

enum FirmwareEventOutcome {
  offered,
  downloading,
  installed,
  failed,
  rejected,
  unknown,
}

extension FirmwareEventOutcomeWire on FirmwareEventOutcome {
  String get wireValue => switch (this) {
    FirmwareEventOutcome.offered => 'offered',
    FirmwareEventOutcome.downloading => 'downloading',
    FirmwareEventOutcome.installed => 'installed',
    FirmwareEventOutcome.failed => 'failed',
    FirmwareEventOutcome.rejected => 'rejected',
    FirmwareEventOutcome.unknown => throw StateError('Cannot serialize unknown FirmwareEventOutcome'),
  };
}

FirmwareEventOutcome firmwareEventOutcomeFromWire(String value) => switch (value) {
  'offered' => FirmwareEventOutcome.offered,
  'downloading' => FirmwareEventOutcome.downloading,
  'installed' => FirmwareEventOutcome.installed,
  'failed' => FirmwareEventOutcome.failed,
  'rejected' => FirmwareEventOutcome.rejected,
  _ => FirmwareEventOutcome.unknown,
};

enum FirmwareRolloutStatus {
  draft,
  scheduled,
  active,
  paused,
  completed,
  failed,
  cancelled,
  unknown,
}

extension FirmwareRolloutStatusWire on FirmwareRolloutStatus {
  String get wireValue => switch (this) {
    FirmwareRolloutStatus.draft => 'draft',
    FirmwareRolloutStatus.scheduled => 'scheduled',
    FirmwareRolloutStatus.active => 'active',
    FirmwareRolloutStatus.paused => 'paused',
    FirmwareRolloutStatus.completed => 'completed',
    FirmwareRolloutStatus.failed => 'failed',
    FirmwareRolloutStatus.cancelled => 'cancelled',
    FirmwareRolloutStatus.unknown => throw StateError('Cannot serialize unknown FirmwareRolloutStatus'),
  };
}

FirmwareRolloutStatus firmwareRolloutStatusFromWire(String value) => switch (value) {
  'draft' => FirmwareRolloutStatus.draft,
  'scheduled' => FirmwareRolloutStatus.scheduled,
  'active' => FirmwareRolloutStatus.active,
  'paused' => FirmwareRolloutStatus.paused,
  'completed' => FirmwareRolloutStatus.completed,
  'failed' => FirmwareRolloutStatus.failed,
  'cancelled' => FirmwareRolloutStatus.cancelled,
  _ => FirmwareRolloutStatus.unknown,
};

enum DeviceHardwareProfile {
  smartcuraEsp32V1,
  unknown,
}

extension DeviceHardwareProfileWire on DeviceHardwareProfile {
  String get wireValue => switch (this) {
    DeviceHardwareProfile.smartcuraEsp32V1 => 'smartcura_esp32_v1',
    DeviceHardwareProfile.unknown => throw StateError('Cannot serialize unknown DeviceHardwareProfile'),
  };
}

DeviceHardwareProfile deviceHardwareProfileFromWire(String value) => switch (value) {
  'smartcura_esp32_v1' => DeviceHardwareProfile.smartcuraEsp32V1,
  _ => DeviceHardwareProfile.unknown,
};

class FirmwareVersion {
  const FirmwareVersion({
    required this.firmwareVersionId,
    required this.hardwareProfile,
    required this.version,
    required this.sha256,
    required this.sizeBytes,
    required this.releasedAt,
    required this.createdAt,
  });

  final UuidV7 firmwareVersionId;
  final DeviceHardwareProfile hardwareProfile;
  final String version;
  final String sha256;
  final int sizeBytes;
  final String? releasedAt;
  final Timestamp createdAt;

  factory FirmwareVersion.fromJson(Map<String, Object?> json) => FirmwareVersion(
    firmwareVersionId: json['firmware_version_id'] as String,
    hardwareProfile: deviceHardwareProfileFromWire(json['hardware_profile'] as String),
    version: json['version'] as String,
    sha256: json['sha256'] as String,
    sizeBytes: (json['size_bytes'] as num).toInt(),
    releasedAt: json['released_at'] == null ? null : json['released_at'] as String,
    createdAt: json['created_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'firmware_version_id': firmwareVersionId,
    'hardware_profile': hardwareProfile.wireValue,
    'version': version,
    'sha256': sha256,
    'size_bytes': sizeBytes,
    'released_at': releasedAt,
    'created_at': createdAt,
  };
}

class FirmwareVersionCheck {
  const FirmwareVersionCheck({
    required this.hardwareProfile,
    required this.currentVersion,
    required this.latestVersion,
    required this.updateAvailable,
    required this.firmwareVersion,
  });

  final DeviceHardwareProfile hardwareProfile;
  final String? currentVersion;
  final String? latestVersion;
  final bool updateAvailable;
  final FirmwareVersion? firmwareVersion;

  factory FirmwareVersionCheck.fromJson(Map<String, Object?> json) => FirmwareVersionCheck(
    hardwareProfile: deviceHardwareProfileFromWire(json['hardware_profile'] as String),
    currentVersion: json['current_version'] == null ? null : json['current_version'] as String,
    latestVersion: json['latest_version'] == null ? null : json['latest_version'] as String,
    updateAvailable: json['update_available'] as bool,
    firmwareVersion: json['firmware_version'] == null ? null : FirmwareVersion.fromJson(json['firmware_version'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'hardware_profile': hardwareProfile.wireValue,
    'current_version': currentVersion,
    'latest_version': latestVersion,
    'update_available': updateAvailable,
    'firmware_version': firmwareVersion?.toJson(),
  };
}

class FirmwareDownloadOperation {
  const FirmwareDownloadOperation({
    required this.method,
    required this.url,
    required this.expiresAt,
    required this.requiredHeaders,
  });

  final String method;
  final String url;
  final Timestamp expiresAt;
  final Map<String, Object?> requiredHeaders;

  factory FirmwareDownloadOperation.fromJson(Map<String, Object?> json) => FirmwareDownloadOperation(
    method: json['method'] as String,
    url: json['url'] as String,
    expiresAt: json['expires_at'] as String,
    requiredHeaders: Map<String, Object?>.from(json['required_headers'] as Map),
  );

  Map<String, Object?> toJson() => {
    'method': method,
    'url': url,
    'expires_at': expiresAt,
    'required_headers': requiredHeaders,
  };
}

class FirmwareDownload {
  const FirmwareDownload({
    required this.firmwareVersionId,
    required this.version,
    required this.sha256,
    required this.sizeBytes,
    required this.download,
  });

  final UuidV7 firmwareVersionId;
  final String version;
  final String sha256;
  final int sizeBytes;
  final FirmwareDownloadOperation download;

  factory FirmwareDownload.fromJson(Map<String, Object?> json) => FirmwareDownload(
    firmwareVersionId: json['firmware_version_id'] as String,
    version: json['version'] as String,
    sha256: json['sha256'] as String,
    sizeBytes: (json['size_bytes'] as num).toInt(),
    download: FirmwareDownloadOperation.fromJson(json['download'] as Map<String, Object?>),
  );

  Map<String, Object?> toJson() => {
    'firmware_version_id': firmwareVersionId,
    'version': version,
    'sha256': sha256,
    'size_bytes': sizeBytes,
    'download': download.toJson(),
  };
}

class CreateFirmwareRolloutRequest {
  const CreateFirmwareRolloutRequest({
    required this.firmwareVersionId,
    required this.organizationId,
    required this.status,
    required this.scheduledAt,
  });

  final UuidV7 firmwareVersionId;
  final UuidV7 organizationId;
  final FirmwareRolloutStatus status;
  final String? scheduledAt;

  factory CreateFirmwareRolloutRequest.fromJson(Map<String, Object?> json) => CreateFirmwareRolloutRequest(
    firmwareVersionId: json['firmware_version_id'] as String,
    organizationId: json['organization_id'] as String,
    status: firmwareRolloutStatusFromWire(json['status'] as String),
    scheduledAt: json['scheduled_at'] == null ? null : json['scheduled_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'firmware_version_id': firmwareVersionId,
    'organization_id': organizationId,
    'status': status.wireValue,
    'scheduled_at': scheduledAt,
  };
}

class FirmwareRollout {
  const FirmwareRollout({
    required this.rolloutId,
    required this.firmwareVersionId,
    required this.organizationId,
    required this.status,
    required this.scheduledAt,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
  });

  final UuidV7 rolloutId;
  final UuidV7 firmwareVersionId;
  final UuidV7 organizationId;
  final FirmwareRolloutStatus status;
  final String? scheduledAt;
  final int version;
  final Timestamp createdAt;
  final Timestamp updatedAt;

  factory FirmwareRollout.fromJson(Map<String, Object?> json) => FirmwareRollout(
    rolloutId: json['rollout_id'] as String,
    firmwareVersionId: json['firmware_version_id'] as String,
    organizationId: json['organization_id'] as String,
    status: firmwareRolloutStatusFromWire(json['status'] as String),
    scheduledAt: json['scheduled_at'] == null ? null : json['scheduled_at'] as String,
    version: (json['version'] as num).toInt(),
    createdAt: json['created_at'] as String,
    updatedAt: json['updated_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'rollout_id': rolloutId,
    'firmware_version_id': firmwareVersionId,
    'organization_id': organizationId,
    'status': status.wireValue,
    'scheduled_at': scheduledAt,
    'version': version,
    'created_at': createdAt,
    'updated_at': updatedAt,
  };
}

class RecordFirmwareEventRequest {
  const RecordFirmwareEventRequest({
    required this.firmwareVersionId,
    required this.rolloutId,
    required this.outcome,
    required this.detailCode,
    this.occurredAt,
  });

  final UuidV7 firmwareVersionId;
  final UuidV7? rolloutId;
  final FirmwareEventOutcome outcome;
  final String? detailCode;
  final String? occurredAt;

  factory RecordFirmwareEventRequest.fromJson(Map<String, Object?> json) => RecordFirmwareEventRequest(
    firmwareVersionId: json['firmware_version_id'] as String,
    rolloutId: json['rollout_id'] == null ? null : json['rollout_id'] as String,
    outcome: firmwareEventOutcomeFromWire(json['outcome'] as String),
    detailCode: json['detail_code'] == null ? null : json['detail_code'] as String,
    occurredAt: json['occurred_at'] == null ? null : json['occurred_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'firmware_version_id': firmwareVersionId,
    'rollout_id': rolloutId,
    'outcome': outcome.wireValue,
    'detail_code': detailCode,
    'occurred_at': occurredAt,
  };
}

class DeviceFirmwareEvent {
  const DeviceFirmwareEvent({
    required this.eventId,
    required this.deviceId,
    required this.rolloutId,
    required this.firmwareVersionId,
    required this.outcome,
    required this.detailCode,
    required this.occurredAt,
  });

  final UuidV7 eventId;
  final UuidV7 deviceId;
  final UuidV7? rolloutId;
  final UuidV7 firmwareVersionId;
  final FirmwareEventOutcome outcome;
  final String? detailCode;
  final Timestamp occurredAt;

  factory DeviceFirmwareEvent.fromJson(Map<String, Object?> json) => DeviceFirmwareEvent(
    eventId: json['event_id'] as String,
    deviceId: json['device_id'] as String,
    rolloutId: json['rollout_id'] == null ? null : json['rollout_id'] as String,
    firmwareVersionId: json['firmware_version_id'] as String,
    outcome: firmwareEventOutcomeFromWire(json['outcome'] as String),
    detailCode: json['detail_code'] == null ? null : json['detail_code'] as String,
    occurredAt: json['occurred_at'] as String,
  );

  Map<String, Object?> toJson() => {
    'event_id': eventId,
    'device_id': deviceId,
    'rollout_id': rolloutId,
    'firmware_version_id': firmwareVersionId,
    'outcome': outcome.wireValue,
    'detail_code': detailCode,
    'occurred_at': occurredAt,
  };
}
