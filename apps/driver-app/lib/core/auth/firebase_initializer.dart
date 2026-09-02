import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/foundation.dart';

/// Global flag set by [initializeFirebase]. When false, the auth screens show a
/// "Firebase not configured — contact admin" state instead of attempting to
/// sign in (which would crash without google-services.json / GoogleService-Info.plist).
///
/// Every other code path (dashboard, dispatch, etc.) reads session cookies,
/// not Firebase, so they keep working even when this flag is false — they just
/// cannot be reached until a session exists.
bool firebaseConfigured = false;

/// Attempt to initialise Firebase. Sets [firebaseConfigured] to true on success
/// and to false (without throwing) when the platform config files are missing.
///
/// The graceful fallback is intentional: the driver app is being built before
/// the Firebase project is provisioned, so a fresh checkout has no config files.
/// Crashing on launch would block all other development.
Future<void> initializeFirebase() async {
  try {
    if (Platform.isAndroid || Platform.isIOS) {
      await Firebase.initializeApp();
      firebaseConfigured = true;
      debugPrint('Firebase initialized successfully.');
    } else {
      // Desktop / web targets are not part of the driver app's supported set.
      debugPrint('Firebase init skipped: unsupported platform for driver app.');
      firebaseConfigured = false;
    }
  } catch (e, st) {
    // MissingOptionsException / [core/no-options] when no config file is present.
    debugPrint('Firebase initialization failed — running in fallback mode.\n'
        'Auth screens will show a "contact admin" state.\nError: $e\n$st');
    firebaseConfigured = false;
  }
}
