import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'auth_service.dart';

/// Lifecycle of the authenticated session, from "we don't know yet" through
/// "signed out" and "signed in". The router reads this to decide where to send
/// the user on launch and on every navigation.
enum AuthStatus {
  /// Before [AuthNotifier.bootstrap] has resolved — show the splash screen.
  unknown,

  /// No valid session and not mid-sign-in.
  unauthenticated,

  /// A bootstrap was fetched; routing now depends on [AuthState.bootstrapState].
  authenticated,

  /// An in-flight sign-in / sign-up attempt failed with a recoverable error.
  error,
}

/// Immutable auth state. Kept minimal: the heavy objects (profile, memberships)
/// live here so derived providers can expose them without re-fetching.
class AuthState {
  const AuthState({
    required this.status,
    this.bootstrapState,
    this.profile,
    this.memberships,
    this.error,
  });

  final AuthStatus status;

  /// The `bootstrap_state` from the last session bootstrap. Drives routing:
  /// `profile_required` → profile setup, `verification_pending` → that screen,
  /// `role_selection_required` → role picker, `ready` → dashboard.
  final BootstrapState? bootstrapState;

  final Profile? profile;
  final List<Membership>? memberships;

  /// The last recoverable error message (sign-in failure etc.).
  final String? error;

  AuthState copyWith({
    AuthStatus? status,
    BootstrapState? bootstrapState,
    Profile? profile,
    List<Membership>? memberships,
    String? error,
  }) {
    return AuthState(
      status: status ?? this.status,
      bootstrapState: bootstrapState ?? this.bootstrapState,
      profile: profile ?? this.profile,
      memberships: memberships ?? this.memberships,
      error: error,
    );
  }

  static const initial = AuthState(status: AuthStatus.unknown);
}

/// Manages auth state and exposes actions to the UI.
///
/// On creation it registers itself with the [ApiClient] so a 401 from any
/// request flips the state to unauthenticated (which the router redirect turns
/// into a trip to /login). [bootstrap] is called once from main.dart / the
/// splash screen to try restoring a stored session.
class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._ref) : super(AuthState.initial) {
    // Wire the API client's session-expired callback to our sign-out path.
    _apiClient.onSessionExpired(() {
      if (mounted) {
        state = AuthState.initial.copyWith(
          status: AuthStatus.unauthenticated,
          error: 'Your session has expired. Please sign in again.',
        );
      }
    });
  }

  final Ref _ref;
  AuthService get _authService => _ref.read(authServiceProvider);
  ApiClient get _apiClient => _ref.read(apiClientProvider);

  /// Attempt to restore a session from secure storage. Called once on launch.
  Future<void> bootstrap() async {
    try {
      final bootstrap = await _authService.restoreSession();
      if (!mounted) return;
      if (bootstrap == null) {
        state = const AuthState(
          status: AuthStatus.unauthenticated,
        );
      } else {
        state = AuthState(
          status: AuthStatus.authenticated,
          bootstrapState: bootstrap.bootstrapState,
          profile: bootstrap.profile,
          memberships: bootstrap.memberships,
        );
      }
    } on ApiError catch (e) {
      if (!mounted) return;
      state = AuthState(
        status: AuthStatus.unauthenticated,
        error: e.displayMessage,
      );
    } catch (e) {
      if (!mounted) return;
      debugPrint('Auth bootstrap failed: $e');
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }

  /// Refresh a live session when the app returns from background. Swallows
  /// transient network errors and only logs out when the server explicitly
  /// invalidates the session.
  Future<void> touchSession() async {
    if (state.status != AuthStatus.authenticated) return;
    try {
      final bootstrap = await _authService.touchSession();
      if (!mounted) return;
      if (bootstrap == null) {
        state = const AuthState(status: AuthStatus.unauthenticated);
      } else {
        state = state.copyWith(
          bootstrapState: bootstrap.bootstrapState,
          profile: bootstrap.profile,
          memberships: bootstrap.memberships,
        );
      }
    } catch (e) {
      debugPrint('Session touch failed (ignored): $e');
    }
  }

  /// Sign in with email/password. On success, transitions to authenticated and
  /// stashes the bootstrap so routing can branch on `bootstrapState`.
  Future<bool> signIn({required String email, required String password}) async {
    try {
      final bootstrap =
          await _authService.signIn(email: email, password: password);
      if (!mounted) return false;
      state = AuthState(
        status: AuthStatus.authenticated,
        bootstrapState: bootstrap.bootstrapState,
        profile: bootstrap.profile,
        memberships: bootstrap.memberships,
      );
      return true;
    } on ApiError catch (e) {
      if (!mounted) return false;
      state = AuthState(
        status: AuthStatus.error,
        error: e.displayMessage,
      );
      return false;
    } catch (e) {
      if (!mounted) return false;
      state = AuthState(
        status: AuthStatus.error,
        error: 'Sign-in failed: $e',
      );
      return false;
    }
  }

  /// Create a new account and immediately bootstrap a session.
  Future<bool> signUp({
    required String email,
    required String password,
    required String displayName,
  }) async {
    try {
      final bootstrap = await _authService.signUp(
        email: email,
        password: password,
        displayName: displayName,
      );
      if (!mounted) return false;
      state = AuthState(
        status: AuthStatus.authenticated,
        bootstrapState: bootstrap.bootstrapState,
        profile: bootstrap.profile,
        memberships: bootstrap.memberships,
      );
      return true;
    } on ApiError catch (e) {
      if (!mounted) return false;
      state = AuthState(status: AuthStatus.error, error: e.displayMessage);
      return false;
    } catch (e) {
      if (!mounted) return false;
      state = AuthState(status: AuthStatus.error, error: 'Sign-up failed: $e');
      return false;
    }
  }

  /// Select the active membership/role after a `role_selection_required`
  /// bootstrap. Updates local storage and refreshes the in-memory state.
  Future<bool> selectActiveRole({required String membershipId}) async {
    try {
      final body = await _apiClient.put(
        ApiEndpoints.sessionsActiveRole,
        body: <String, dynamic>{'membership_id': membershipId},
      );
      await _apiClient.sessionStorage.setActiveMembershipId(membershipId);
      final bootstrap = decodeSessionBootstrap(body);
      if (!mounted) return false;
      state = AuthState(
        status: AuthStatus.authenticated,
        bootstrapState: bootstrap.bootstrapState,
        profile: bootstrap.profile,
        memberships: bootstrap.memberships,
      );
      return true;
    } on ApiError catch (e) {
      if (!mounted) return false;
      state = AuthState(status: AuthStatus.error, error: e.displayMessage);
      return false;
    }
  }

  /// Send a password-reset email. Returns true on success.
  Future<bool> sendPasswordReset(String email) async {
    try {
      await _authService.sendPasswordResetEmail(email);
      return true;
    } on ApiError catch (e) {
      if (!mounted) return false;
      state = AuthState(status: AuthStatus.error, error: e.displayMessage);
      return false;
    }
  }

  /// Sign out everywhere and reset state.
  Future<void> signOut() async {
    await _authService.signOut();
    if (!mounted) return;
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Clear only the transient error, keeping the rest of the state intact.
  void clearError() {
    if (!mounted) return;
    state = state.copyWith(error: null);
  }

  /// Replace the cached profile with a freshly-mutated one. Called after
  /// avatar upload/remove so screens reading [currentProfileProvider] render
  /// the new image without requiring a fresh sign-in.
  void refreshProfile(Profile profile) {
    if (!mounted) return;
    state = state.copyWith(profile: profile);
  }
}

/// The primary auth state provider.
final authProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier(ref));

/// Convenience: the currently authenticated profile, or null.
final currentProfileProvider =
    Provider<Profile?>((ref) => ref.watch(authProvider).profile);

/// Convenience: true when a valid session exists.
final isAuthenticatedProvider = Provider<bool>(
    (ref) => ref.watch(authProvider).status == AuthStatus.authenticated);

/// Convenience: the memberships carried by the last bootstrap, or null.
final membershipsProvider =
    Provider<List<Membership>?>((ref) => ref.watch(authProvider).memberships);

/// Convenience: the bootstrap state driving routing, or null when unknown.
final bootstrapStateProvider =
    Provider<BootstrapState?>((ref) => ref.watch(authProvider).bootstrapState);

/// Convenience: the first (or only) membership id from the last bootstrap.
/// The doctor app currently assumes a single active doctor membership; when
/// role selection is implemented this will read the stored active membership
/// id instead. Returns null when no memberships are available.
final activeMembershipIdProvider = Provider<String?>((ref) {
  final memberships = ref.watch(membershipsProvider);
  if (memberships == null || memberships.isEmpty) return null;
  return memberships.first.id;
});
