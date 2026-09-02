import 'package:smartcura_contracts/smartcura_contracts.dart';

/// Local model that maps the backend `SessionBootstrapResponse` JSON shape
/// (snake_case wire format) into the generated contract types.
///
/// The generated `SessionBootstrapResponse` class in `smartcura_contracts` is a
/// plain const constructor with no fromJson, so we provide the deserialisation
/// here. This keeps the contract package dependency-free while giving the app
/// typed access to the bootstrap payload.
class SessionBootstrap {
  final BootstrapState bootstrapState;
  final String csrfToken;
  final Profile profile;
  final List<Membership> memberships;
  final SessionView session;

  const SessionBootstrap({
    required this.bootstrapState,
    required this.csrfToken,
    required this.profile,
    required this.memberships,
    required this.session,
  });

  factory SessionBootstrap.fromJson(Map<String, dynamic> json) {
    return SessionBootstrap(
      bootstrapState: bootstrapStateFromWire(json['bootstrap_state'] as String),
      csrfToken: json['csrf_token'] as String,
      profile: ProfileMapper.fromJson(json['profile'] as Map<String, dynamic>),
      memberships: (json['memberships'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map(MembershipMapper.fromJson)
          .toList(),
      session:
          SessionViewMapper.fromJson(json['session'] as Map<String, dynamic>),
    );
  }

  Map<String, dynamic> toJson() => {
        'bootstrap_state': bootstrapState.wireValue,
        'csrf_token': csrfToken,
        'profile': ProfileMapper.toJson(profile),
        'memberships': memberships.map(MembershipMapper.toJson).toList(),
        'session': SessionViewMapper.toJson(session),
      };
}

// ---------------------------------------------------------------------------
// Mappers for generated contract types that lack fromJson/toJson.
// ---------------------------------------------------------------------------

class ProfileMapper {
  static Profile fromJson(Map<String, dynamic> j) => Profile(
        id: j['id'] as String,
        status: profileStatusFromWire(j['status'] as String),
        displayName: j['display_name'] as String,
        email: j['email'] as String,
        phoneE164: j['phone_e164'] as String?,
        preferredLocale: j['preferred_locale'] as String,
        timezone: j['timezone'] as String,
        onboardingCompletedAt: j['onboarding_completed_at'] as String?,
        avatarUrl: j['avatar_url'] as String?,
        createdAt: j['created_at'] as String,
        updatedAt: j['updated_at'] as String,
      );

  static Map<String, dynamic> toJson(Profile p) => {
        'id': p.id,
        'status': p.status.wireValue,
        'display_name': p.displayName,
        'email': p.email,
        'phone_e164': p.phoneE164,
        'preferred_locale': p.preferredLocale,
        'timezone': p.timezone,
        'onboarding_completed_at': p.onboardingCompletedAt,
        'avatar_url': p.avatarUrl,
        'created_at': p.createdAt,
        'updated_at': p.updatedAt,
      };
}

class MembershipMapper {
  static Membership fromJson(Map<String, dynamic> j) => Membership(
        id: j['id'] as String,
        organizationId: j['organization_id'] as String,
        siteIds: (j['site_ids'] as List<dynamic>).whereType<String>().toList(),
        role: roleIdFromWire(j['role'] as String),
        status: membershipStatusFromWire(j['status'] as String),
        verificationStatus: j['verification_status'] == null
            ? null
            : verificationStatusFromWire(j['verification_status'] as String),
        permissions:
            (j['permissions'] as List<dynamic>).whereType<String>().toList(),
      );

  static Map<String, dynamic> toJson(Membership m) => {
        'id': m.id,
        'organization_id': m.organizationId,
        'site_ids': m.siteIds,
        'role': m.role.wireValue,
        'status': m.status.wireValue,
        'verification_status': m.verificationStatus?.wireValue,
        'permissions': m.permissions,
      };
}

class SessionViewMapper {
  static SessionView fromJson(Map<String, dynamic> j) => SessionView(
        id: j['id'] as String,
        status: appSessionStatusFromWire(j['status'] as String),
        profileId: j['profile_id'] as String,
        activeRole: j['active_role'] == null
            ? null
            : roleIdFromWire(j['active_role'] as String),
        createdAt: j['created_at'] as String,
        lastActivityAt: j['last_activity_at'] as String,
        idleExpiresAt: j['idle_expires_at'] as String,
        absoluteExpiresAt: j['absolute_expires_at'] as String,
        stepUpValidUntil: j['step_up_valid_until'] as String?,
      );

  static Map<String, dynamic> toJson(SessionView s) => {
        'id': s.id,
        'status': s.status.wireValue,
        'profile_id': s.profileId,
        'active_role': s.activeRole?.wireValue,
        'created_at': s.createdAt,
        'last_activity_at': s.lastActivityAt,
        'idle_expires_at': s.idleExpiresAt,
        'absolute_expires_at': s.absoluteExpiresAt,
        'step_up_valid_until': s.stepUpValidUntil,
      };
}
