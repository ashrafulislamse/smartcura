import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/session_bootstrap.dart';
import '../network/api_error.dart';
import 'auth_service.dart';

/// Top-level auth status, derived from [AuthState].
enum AuthStatus { unknown, authenticated, unauthenticated }

/// Immutable auth state held by [AuthNotifier].
class AuthState {
  final AuthStatus status;
  final Profile? profile;
  final List<Membership>? memberships;
  final BootstrapState? bootstrapState;
  final String? errorMessage;
  final bool isAuthenticating;

  const AuthState({
    this.status = AuthStatus.unknown,
    this.profile,
    this.memberships,
    this.bootstrapState,
    this.errorMessage,
    this.isAuthenticating = false,
  });

  AuthState copyWith({
    AuthStatus? status,
    Profile? profile,
    List<Membership>? memberships,
    BootstrapState? bootstrapState,
    String? errorMessage,
    bool? isAuthenticating,
  }) {
    return AuthState(
      status: status ?? this.status,
      profile: profile ?? this.profile,
      memberships: memberships ?? this.memberships,
      bootstrapState: bootstrapState ?? this.bootstrapState,
      errorMessage: errorMessage,
      isAuthenticating: isAuthenticating ?? this.isAuthenticating,
    );
  }

  static const unknown = AuthState(status: AuthStatus.unknown);
}

/// The auth state notifier. Owns the login/sign-up/restore/sign-out lifecycle
/// and publishes [AuthState] for the router's redirect logic.
///
/// **Critical:** `login()` and `signUp()` do NOT set the status to `unknown`
/// during the request. Setting it to `unknown` would cause the router redirect
/// to send the user to `/splash` momentarily, which is what caused the
/// "webpage reload" behavior. Instead, we set `isAuthenticating = true` on the
/// current `unauthenticated` state, and only change the status on success or
/// failure.
final authProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier(ref));

class AuthNotifier extends StateNotifier<AuthState> {
  final Ref _ref;

  AuthNotifier(this._ref) : super(AuthState.unknown);

  /// Sign in with email + password. Updates state to authenticated on success,
  /// or sets errorMessage on failure.
  ///
  /// The state stays `unauthenticated` during the request — only
  /// `isAuthenticating` flips to true. This prevents the router from
  /// redirecting to /splash mid-login.
  Future<void> login(String email, String password, String deviceName) async {
    state = const AuthState(
      status: AuthStatus.unauthenticated,
      isAuthenticating: true,
    );
    try {
      final bootstrap = await _ref
          .read(authServiceProvider)
          .signIn(email, password, deviceName);
      _applyBootstrap(bootstrap);
    } on ApiError catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.userMessage,
      );
    } catch (e) {
      state = const AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Sign-in failed. Please try again.',
      );
    }
  }

  /// Create a new account. On success the backend returns a bootstrap with
  /// `profile_required` — the router will send the user to profile setup.
  Future<void> signInWithGoogle(String deviceName) async {
    state = const AuthState(
      status: AuthStatus.unauthenticated,
      isAuthenticating: true,
    );
    try {
      final bootstrap =
          await _ref.read(authServiceProvider).signInWithGoogle(deviceName);
      _applyBootstrap(bootstrap);
    } on ApiError catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.userMessage,
      );
    } catch (e) {
      state = const AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Google sign-in failed. Please try again.',
      );
    }
  }

  Future<void> signUp(
    String email,
    String password,
    String displayName,
    String deviceName,
  ) async {
    state = const AuthState(
      status: AuthStatus.unauthenticated,
      isAuthenticating: true,
    );
    try {
      final bootstrap = await _ref
          .read(authServiceProvider)
          .signUp(email, password, displayName, deviceName);
      _applyBootstrap(bootstrap);
    } on ApiError catch (e) {
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.userMessage,
      );
    } catch (e) {
      state = const AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Account creation failed. Please try again.',
      );
    }
  }

  /// Called on app start to try to restore an existing session. If the session
  /// is gone (401) the state becomes unauthenticated; on network error it stays
  /// unknown so the splash screen can offer a retry.
  Future<void> restoreSession() async {
    try {
      final bootstrap = await _ref.read(authServiceProvider).restoreSession();
      if (bootstrap != null) {
        _applyBootstrap(bootstrap);
      } else {
        state = const AuthState(status: AuthStatus.unauthenticated);
      }
    } on ApiError catch (e) {
      // Network error or server error — go to login so the user is not
      // stuck on a perpetual spinner. They can retry from the login screen.
      state = AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: e.userMessage,
      );
    } catch (e) {
      state = const AuthState(
        status: AuthStatus.unauthenticated,
        errorMessage: 'Could not restore session. Please sign in again.',
      );
    }
  }

  /// Sign out and reset state.
  Future<void> signOut() async {
    await _ref.read(authServiceProvider).signOut();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Re-read the profile from GET /profiles/me and update state. Useful after
  /// profile setup or edit.
  Future<void> refreshProfile() async {
    await restoreSession();
  }

  void _applyBootstrap(SessionBootstrap bootstrap) {
    state = AuthState(
      status: AuthStatus.authenticated,
      profile: bootstrap.profile,
      memberships: bootstrap.memberships,
      bootstrapState: bootstrap.bootstrapState,
      errorMessage: null,
    );
  }
}

// ---------------------------------------------------------------------------
// Convenience providers derived from auth state
// ---------------------------------------------------------------------------

/// The current user's [Profile], or null if not authenticated.
final currentProfileProvider = Provider<Profile?>(
  (ref) => ref.watch(authProvider).profile,
);

/// True when the user has an active session.
final isAuthenticatedProvider = Provider<bool>(
  (ref) => ref.watch(authProvider).status == AuthStatus.authenticated,
);

/// The user's memberships (organization + role + permissions).
final membershipsProvider = Provider<List<Membership>?>(
  (ref) => ref.watch(authProvider).memberships,
);

/// The current bootstrap state — drives post-login routing.
final bootstrapStateProvider = Provider<BootstrapState?>(
  (ref) => ref.watch(authProvider).bootstrapState,
);

/// The first active membership's organization id, or null. Convenience for
/// providers that need the org scope for endpoint construction.
final currentOrganizationIdProvider = Provider<String?>((ref) {
  final memberships = ref.watch(membershipsProvider);
  if (memberships == null || memberships.isEmpty) return null;
  // Prefer an active membership; fall back to the first.
  final active = memberships.firstWhere(
    (m) => m.status == MembershipStatus.active,
    orElse: () => memberships.first,
  );
  return active.organizationId;
});
