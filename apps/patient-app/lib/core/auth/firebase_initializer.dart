import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Global flag set by [initializeFirebase]. When false, auth screens show a
/// "Firebase not configured — contact admin" state instead of crashing.
///
/// Firebase is not configured until `google-services.json` (Android) and
/// `GoogleService-Info.plist` (iOS) are added to the platform folders. Until
/// then `Firebase.initializeApp()` throws, which we catch here.
bool firebaseConfigured = false;

/// Attempts to initialise Firebase. On success sets [firebaseConfigured] to
/// true. On failure (missing config files, wrong options, etc.) sets it to
/// false and logs the reason — the app continues to run so non-auth flows
/// (splash, onboarding preview) still work.
Future<void> initializeFirebase() async {
  try {
    await Firebase.initializeApp();
    firebaseConfigured = true;
    debugPrint('[Firebase] initialised successfully');
  } catch (e) {
    firebaseConfigured = false;
    debugPrint('[Firebase] not configured — auth screens will show a fallback '
        'state. Reason: $e');
  }
}
