# SmartCura Driver App

Flutter driver client for medicine delivery and ambulance operations.

> **Status:** wired to the live backend. Dispatch offers, assignment
> transitions, recipient disclosure, navigation stops, waypoint reporting,
> proof-of-delivery and earnings all use real authenticated `/api/v1` routes
> against generated contract types. Not production-ready.

## Current behavior

- Authentication via Firebase, session exchange with the backend, and the full
  offer → assignment → pickup → dropoff → trip-complete flow with optimistic
  concurrency on every transition.
- The two navigation screens show a live `google_maps_flutter` map with the
  driver's streamed GPS position, the destination marker and a dashed bearing
  line resolved from `GET /dispatch/assignments/{id}/stops`, and report the
  live position to `POST /dispatch/assignments/{id}/waypoints` (throttled
  client- and server-side). The Navigate button hands off to the Google Maps
  app for real turn-by-turn.
- Earnings, vehicles, ratings and support read real endpoints.

## Target integration

- Firebase Auth for driver identity and verification ✅
- NestJS `/api/v1` for dispatch offers, assignments, proof-of-delivery and
  earnings ✅
- Firebase Cloud Messaging for opaque push notifications ✅
- PostgreSQL-backed dispatch, audit and earnings ledger ✅

## Google Maps API key (Android)

Map tiles do not render until a real **Maps SDK for Android** key is installed.

The exact location is:

- File: `android/app/src/main/res/values/strings.xml`
- String resource key: `GOOGLE_MAPS_API_KEY`
- Placeholder value: `YOUR_GOOGLE_MAPS_API_KEY_HERE`

Steps:

1. In the [Google Cloud console](https://console.cloud.google.com/), enable
   **Maps SDK for Android** and create an API key restricted to that single
   product.
2. Restrict the key to this app: add the debug (and later release) SHA-1
   certificate fingerprint plus package name
   `com.smartcura.smartcuraDriverApp`
   (`keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore"`
   `-alias androiddebugkey -storepass android -keypass android`).
3. Replace `YOUR_GOOGLE_MAPS_API_KEY_HERE` with the real key in
   `android/app/src/main/res/values/strings.xml` inside the `<string>` element
   whose `name` is `GOOGLE_MAPS_API_KEY`. The manifest reads this value via
   `@string/GOOGLE_MAPS_API_KEY`.
4. Rebuild. Without the key the map surface stays blank but markers, camera
   and waypoint reporting still run; the external Navigate hand-off is
   unaffected (it opens the Google Maps app).

## Firebase configuration (Android)

The app uses the Firebase project `smartcura-platform` (same project as the
patient and doctor apps). The `google-services.json` at
`android/app/google-services.json` contains the real `project_info` and API
key, but the `mobilesdk_app_id` is a **placeholder**
(`1:000000000000:android:0000000000000000000000`).

Until the real app ID is installed, `Firebase.initializeApp()` will fail at
runtime and the app will fall back to the "Firebase not configured — contact
admin" state on auth screens. All non-auth flows continue to work.

### Replacing the placeholder

1. Open the [Firebase console](https://console.firebase.google.com/) for
   `smartcura-platform`.
2. Add an Android app with package name `com.smartcura.smartcuraDriverApp`.
3. Download the generated `google-services.json` and replace
   `android/app/google-services.json` with it.
4. Rebuild — the `mobilesdk_app_id`, `project_number`, and any OAuth client
   entries in the downloaded file are authoritative.

The `api_key` (`current_key`) in the placeholder is real (it is the same key
used by the patient and doctor apps and is safe to commit — it is a restricted
Android API key, not a server key).

## Run locally

```text
flutter pub get
flutter run
flutter analyze
flutter test
```

Synthetic/test data only. SmartCura is an educational prototype and must not be used
for real emergency response or commercial delivery without the required engineering,
licensing, insurance and regulatory work.
