# Screen-to-Capability Matrix

**Status:** Stage 0A working artifact
**Version:** 0.1
**Baseline date:** 26 July 2026
**Scope:** Routes and screens registered in the patient, doctor and driver Flutter routers, plus every Next.js portal `page.tsx` route.

This is source-derived requirements evidence for `WP-01`; it is not an endpoint specification. OpenAPI and AsyncAPI must normalize the conflicts recorded below rather than copying client mock shapes.

## 1. Baseline and repository safety

| Client | Verification | Result | Interpretation |
|---|---|---|---|
| Patient Flutter | `flutter analyze --no-pub`, severity-filtered standard output | 24 errors, 37 warnings, 2,139 info; 2,200 total | Not compile-clean. Errors are concentrated in AI/IoT screens plus stale `test/widget_test.dart`. |
| Doctor Flutter | `flutter analyze --no-pub`, severity-filtered standard output | 0 errors, 3 warnings, 187 info; 190 total | No analyzer errors; lint cleanup remains. |
| Driver Flutter | `flutter analyze --no-pub`, severity-filtered standard output | 1 error, 6 warnings, 199 info; 206 total | Stale `test/widget_test.dart` references nonexistent `MyApp`. |
| Web portal | `npm run type-check` | Passed | TypeScript check passes; this does not validate mock workflows or authorization. |

The driver app was moved to `apps/driver-app`. A historical source-only safety archive was created outside the repository at `E:\SmartCura-backups\smartcura-driver-app-source-20260726-015238.zip`. It contains 136 files, excludes `build` and `.dart_tool`, opens successfully, and has SHA-256 `B4D6EA69F272A7B06D347B130253449091716AF9469D16FD864F6706BEC71787`. Its adjacent inventory records per-file hashes. No files were staged or committed.

Backend foundation and identity/session source now exist, but no client route in this inventory has been migrated from its mock/local authority. Capability migration state therefore remains `mock` until a client uses the real API end to end; backend-only progress is recorded separately in the implementation plan.

## 2. Source evidence

- Patient routes: `apps/patient-app/lib/core/router/app_router.dart`
- Patient business mocks: `apps/patient-app/lib/core/providers/mock_data_provider.dart`
- Patient IoT simulation: `apps/patient-app/lib/core/providers/iot_data_provider.dart`
- Patient AI simulation: `apps/patient-app/lib/core/providers/ai_diagnosis_provider.dart`
- Doctor routes: `apps/doctor-app/lib/core/router/app_router.dart`
- Driver routes and data: `apps/driver-app/lib/core/router/app_router.dart`, `apps/driver-app/lib/core/data/mock_data.dart`
- Portal routes: `apps/web-portal/src/app/**/page.tsx`
- Portal business mocks: `apps/web-portal/src/lib/mock-data.ts` plus page-local constants
- Portal identity and client authorization: `apps/web-portal/src/store/authStore.ts`, `src/lib/rbac/*`, `src/lib/session/sessionManager.ts`
- Portal `src/app/api/` is empty; no portal route is backed by a real application API.

## 3. Registered route and screen inventory

Route-group labels in this section are referenced by the capability matrix. Routes absent from these source routers are not claimed as implemented.

### P — Patient Flutter (46 registered routes)

- **P-AUTH:** `/splash` → `SplashScreen`; `/onboarding` → `OnboardingScreen`; `/login` → `LoginScreen`; `/signup` → `SignUpScreen`; `/forgot-password` → `ForgotPasswordScreen`.
- **P-IOT:** `/iot/device-pairing-intro` → `IoTDeviceDiscoveryHubScreen`; `/iot/device-management` → `IoTDeviceManagementHubScreen`; `/iot/select-device-type` → `PairingSelectDeviceTypeScreen`; `/iot/enable-permissions` → `PairingEnablePermissionsScreen`; `/iot/establishing-connection` → `PairingEstablishingConnectionScreen`; `/iot/pairing-successful` → `PairingSuccessful1Screen`; `/iot/sensor-calibration` → `IotSensorCalibrationScreen`; `/iot/firmware-update` → `DeviceFirmwareUpdateHubScreen`; `/iot/data-sync` → `OfflineDataSyncManagerScreen`.
- **P-AI:** `/ai/diagnosis-summary-1` → `SmartDiagnosisSummaryView1Screen`; `/ai/diagnosis-summary-2` → `SmartDiagnosisSummaryView2Screen`; `/ai/diagnosis-summary-3` → `SmartDiagnosisSummaryView3Screen`; `/ai-chat` → `AIChatScreen`.
- **P-CARE:** `/find-doctor` → `FindDoctorScreen`; `/doctor-profile` → `DoctorProfileScreen`; `/book-appointment` → `BookAppointmentScreen`; `/schedule` → `AppointmentsScreen`; `/appointment-details` → `AppointmentDetailsScreen`; `/reschedule-appointment` → `RescheduleAppointmentScreen`; `/reschedule-success` → `RescheduleSuccessScreen`.
- **P-PAY:** `/payment` → `PaymentScreen`; `/payment-success` → `PaymentSuccessScreen`; `/payment-failed` → `PaymentFailedScreen`.
- **P-CONSULT:** `/video-consultation` → `VideoConsultationScreen`; `/audio-consultation` → `AudioConsultationScreen`; `/doctor-chat` → `DoctorChatScreen`; `/messages` → `MessagesListScreen`; `/prescriptions` → `PrescriptionsListScreen`; `/prescriptions/:id` → `PrescriptionDetailsScreen`.
- **P-HEALTH:** `/health` → `HealthScreen`; `/health/enter-vitals` → `EnterVitalsScreen`; `/medical-id-intro` → `MedicalIdIntroScreen`.
- **P-EMERGENCY:** `/emergency-contacts-setup` → `EmergencyContactsSetupScreen`; `/emergency-sos` → `EmergencySOSScreen`.
- **P-ACCOUNT:** `/home` → `HomeScreenV2`; `/notifications` → `NotificationsScreen`; `/profile` → `ProfileScreen`; `/edit-profile` → `EditProfileScreen`; `/settings` → `SettingsScreen`; `/notification-preferences` → `NotificationPreferencesScreen`; `/help-support` → `HelpSupportScreen`.

The configured initial route is `/home`, so P-AUTH is currently bypassed.

### D — Doctor Flutter (22 registered routes)

- **D-AUTH:** `/splash` → `SplashScreen`; `/onboarding` → `OnboardingScreen`; `/login` → `LoginScreen`; `/register` → `RegistrationScreen`; `/verification-pending` → `VerificationPendingScreen`; `/forgot-password` → `ForgotPasswordScreen`.
- **D-WORK:** `/dashboard` → `DashboardScreen`; `/appointments` → `AppointmentsListScreen`; `/appointment-details` → `AppointmentDetailsScreen`; `/my-schedule` → `MyScheduleScreen`.
- **D-CARE:** `/video-consultation` → `VideoConsultationScreen`; `/chat-consultation` → `ChatConsultationScreen`; `/consultation-notes` → `ConsultationNotesScreen`; `/e-prescription` → `EPrescriptionScreen`; `/messages` → `MessagesListScreen`; `/patients` → `PatientsListScreen`; `/patient-details` → `PatientDetailsScreen`.
- **D-ACCOUNT:** `/notifications` → `NotificationsScreen`; `/profile` → `ProfileScreen`; `/edit-profile` → `EditProfileScreen`; `/settings` → `SettingsScreen`; `/help-support` → `HelpSupportScreen`.

### R — Driver Flutter (21 registered routes)

- **R-AUTH:** `/splash` → `SplashScreen`; `/login` → `LoginScreen`; `/otp` → `OtpVerificationScreen`; `/register` → `RegistrationScreen`; `/documents` → `DocumentUploadScreen`; `/onboarding` → `OnboardingScreen`; `/forgot-password` → `ForgotPasswordScreen`.
- **R-DISPATCH:** `/dashboard` → `DriverDashboardScreen`; `/orders` → `AvailableOrdersScreen`; `/order-details` → `OrderDetailsScreen`; `/nav-pickup` → `NavigationToPickupScreen`; `/pickup-confirm` → `PickupConfirmationScreen`; `/nav-hospital` → `NavigationToHospitalScreen`; `/delivery-confirm` → `DeliveryConfirmationScreen`; `/trip-complete` → `TripCompleteScreen`; `/order-history` → `OrderHistoryScreen`.
- **R-ACCOUNT:** `/notifications` → `NotificationsScreen`; `/earnings` → `EarningsScreen`; `/withdraw` → `WithdrawalScreen`; `/profile` → `ProfileScreen`; `/settings` → `SettingsScreen`.

The `MockOrder` list mixes `ORD-*` pharmacy deliveries and `AMB-*` ambulance cases. They are separate domain aggregates despite sharing assignment and location mechanics.

### W — Web portal (71 page routes)

- **W-PUBLIC:** `/`; `/login`; `/2fa`; `/role-select`; `/error-403`; `/error-500`. The root `not-found.tsx` is also present but is framework fallback UI rather than a route capability.
- **W-CORE:** `/dashboard`; `/appointments`; `/appointments/[id]`.
- **W-DOCTOR:** `/doctor/dashboard`; `/doctor/appointments`; `/doctor/appointments/[id]`; `/doctor/schedule`; `/doctor/patients`; `/doctor/patients/[id]`; `/doctor/patients/[id]/consultation`; `/doctor/notes`; `/doctor/prescriptions`; `/doctor/templates`; `/doctor/templates/[id]`; `/doctor/iot/patients`; `/doctor/iot/patients/[id]/history`; `/doctor/ai/assistant`; `/doctor/analytics`; `/doctor/earnings`.
- **W-EMERGENCY:** `/emergency`; `/emergency/analytics`; `/emergency/communications`; `/emergency/dispatch/[id]`; `/emergency/fleet`; `/emergency/logs`; `/emergency/map`; `/emergency/personnel`; `/emergency/queue`; `/emergency/resolution/[id]`; `/emergency/settings`; `/emergency/triage`.
- **W-FINANCE:** `/finance`; `/finance/payouts`; `/finance/transactions`.
- **W-PHARMACY:** `/pharmacy`; `/pharmacy/analytics`; `/pharmacy/controlled-substances`; `/pharmacy/dashboard`; `/pharmacy/fulfillment`; `/pharmacy/intake`; `/pharmacy/inventory`; `/pharmacy/logistics`; `/pharmacy/orders`; `/pharmacy/orders/[id]`; `/pharmacy/procurement`; `/pharmacy/reconciliation`; `/pharmacy/returns`; `/pharmacy/settings`; `/pharmacy/validation`.
- **W-SETTINGS:** `/settings`; `/settings/admin-users`; `/settings/analytics`; `/settings/audit-logs`; `/settings/notifications`; `/settings/profile`; `/settings/roles`.
- **W-SUPPORT:** `/support/faq`; `/support/notifications`; `/support/tickets`; `/support/tickets/[id]`.
- **W-USERS:** `/users/doctors`; `/users/doctors/[id]`; `/users/patients`; `/users/patients/[id]`; `/users/verification`.

## 4. Capability matrix

`Current source` names the current runtime data authority, not merely a UI helper. `Files/providers` identifies required future integration. Priority is relative to the delivery plan: `required_fyp` precedes `required_full`; `future_not_committed` is intentionally outside the accepted full-platform scope. No inventoried capability currently qualifies as `hybrid` or `real`.

| Capability | Client screens/routes | Actor | Commands | Queries/read models | Realtime/events | Files/providers | Current source | Work package | Priority | Migration state |
|---|---|---|---|---|---|---|---|---|---|---|
| Identity, onboarding and sessions | P-AUTH; D-AUTH; R-AUTH; W-PUBLIC; W-SETTINGS profile/admin-users/roles | Patient, doctor, driver, pharmacy, emergency operator, admin, super-admin | Register; verify email/OTP/TOTP; sign in/out; recover password; select active role; revoke/deactivate session | Current profile; memberships; roles; permissions; session state | Session revoked; membership changed; verification completed | Firebase Auth/Identity Platform; FCM token registration | Flutter auth screens remain local navigation/forms. Portal `authStore.ts` is migrated to backend application sessions: no persistence, no hardcoded credentials or 2FA code, no fake tokens, permissions only from the server-selected membership, and `sessionManager.ts`/`auditLogger.ts` are non-authoritative. The portal has no identity provider registered, so sign-in and step-up fail closed until one is configured. Patient starts at `/home`. The backend now implements provider-neutral identity verification plus session bootstrap/current/refresh/step-up/role-selection/revocation, but no client consumes those routes yet. | WP-03 | required_fyp | mock |
| Patient/doctor/driver profiles, verification, consent and private files | P-ACCOUNT; P-HEALTH medical ID; D-AUTH registration/verification; D-ACCOUNT; R-AUTH registration/documents; R-ACCOUNT profile; W-USERS; W-SETTINGS profile | Record owner; doctor; driver; verifier/admin; assigned clinician | Create/update profile; upload/finalize document; approve/reject/suspend; manage address, emergency contact, condition/allergy, consent and care assignment | Profile summary/details; verification queue/history; document status; medical ID; care access | Verification status changed; consent/access changed | Cloudflare R2 presigned upload; ClamAV; Firebase identity link | Screen-local form state and hardcoded values; portal doctor/patient pages import `src/lib/mock-data.ts`; no upload authority or object access service | WP-04 | required_fyp | mock |
| Doctor discovery and approved-provider details | P-CARE find/profile; W-USERS doctors/verification | Patient; approved doctor; verifier/admin | Search/filter; review doctor; approve verification; create/revoke care assignment | Doctor card/profile; specialties; languages; fees; ratings; next availability; verification state | Doctor verification/profile availability changed | PostgreSQL FTS/trigram; Cloudflare R2 for approved public/private media | Patient `mockDoctorsProvider`; portal `mockDoctors`; identifiers and displayed availability are static | WP-04 | required_fyp | mock |
| Availability, appointments and simulated payment | P-CARE; P-PAY; D-WORK; W-CORE appointments; W-DOCTOR appointments/schedule | Patient; doctor; admin | Manage rules/exceptions; hold slot; book; simulate/confirm payment; check in; cancel; reschedule by replacement; mark no-show | Slot search; appointment list/detail/history; payment/refund projection; doctor schedule | Hold expired; appointment status changed; payment/refund event; reminder | MockPaymentProvider; outbox + FCM | Patient `mockAppointmentsProvider` plus route extras/hardcoded payment values; doctor screens use local/static data; portal `mockAppointments` | WP-05 | required_fyp | mock |
| Consultation, secure messaging, notes, prescriptions and notifications | P-CONSULT; P-ACCOUNT notifications/preferences; D-CARE; D-ACCOUNT notifications; W-DOCTOR patients/consultation/notes/prescriptions/templates; W-SUPPORT notifications | Patient; assigned doctor; admin for templates where authorized | Start/join/end consultation; send message; mark read; write/version/sign note; issue/supersede prescription; update notification preferences | Consultation state; conversation/message feed; receipts; notes/history; prescription/PDF; notification feed | LiveKit room events; Socket.IO messages/receipts/typing; consultation/prescription events; FCM delivery | Self-hosted LiveKit; Cloudflare R2 PDF/files; FCM; outbox worker | Patient conversation/message/prescription providers and screen-local call UI; doctor screen-local workflows; portal page-local mocks. No LiveKit, Socket.IO, immutable signing or server receipt authority | WP-06 | required_fyp | mock |
| IoT devices, vitals, calibration, sync, firmware and alerts | P-IOT; P-HEALTH; W-DOCTOR IoT pages; doctor patient detail/dashboard evidence | Patient/device owner; assigned doctor; device operator/admin | Provision/assign/revoke device; ingest/manual-enter reading; calibrate; sync replay; set threshold; acknowledge/escalate alert; issue command; register/roll out firmware | Device status/battery/version; latest/history/aggregates; sync queue; alert list; calibration/command/OTA state | MQTT vitals/status/acks; Socket.IO reading/alert stream; offline/reconnected/threshold events | Mosquitto TLS/ACL; ESP32 simulator/hardware; Cloudflare R2 firmware; FCM | Patient `IoTDataProvider` contains static devices/readings and no-op connect methods; manual vitals are local; portal doctor IoT pages are mock UI | WP-07 | required_fyp | mock |
| AI symptom conversation, governed artifacts and doctor review | P-AI; P-CONSULT AI chat; W-DOCTOR AI assistant; doctor review evidence | Patient; assigned/reviewing doctor; AI operator/admin | Start conversation; answer follow-up; request generation; create candidate/artifact; approve/reject/supersede; rerun version | Conversation; artifact with model/prompt/provenance; safety events; forecast/anomaly; review history | Generation progress/completed/failed; review state changed | OpenAI-compatible provider via `LlmProvider`; mandatory mock provider; pgvector RAG; private FastAPI statistical ML | Patient `AIDiagnosisProvider` delays then returns static “diagnoses,” confidence and recommendations; AI chat/portal are local mock UI; no provenance or review authority | WP-08 | required_fyp | mock |
| Pharmacy, prescription validation and inventory | W-PHARMACY; W-DOCTOR prescriptions; delivery intake dependency in R-DISPATCH | Pharmacist/manager; doctor; patient; stock controller; admin | Intake/validate prescription; reserve FEFO stock; fulfil; dispatch; receive procurement; return/reconcile; controlled-substance action | Orders/items/status; catalogue; batches/expiry; availability; immutable stock ledger; procurement/returns; analytics | Order/validation/reservation/dispatch events; low-stock/expiry alerts | Cloudflare R2 prescription/proof files; outbox + FCM | Portal central and page-local mock data; order detail imports `mockPharmacyOrders`; no ledger, reservation or site transaction authority | WP-10 | required_full | mock |
| Driver verification, delivery dispatch, tracking, proof and earnings | R-AUTH documents; R-DISPATCH for `ORD-*`; R-ACCOUNT; W-PHARMACY logistics; W-FINANCE | Driver; dispatcher/pharmacy; patient recipient; finance/admin | Verify driver/vehicle; offer/accept/decline job; update availability; record waypoint; confirm pickup/delivery; upload proof; rate; request withdrawal | Available/active/history jobs; route/ETA; proof status; earnings ledger/balance; bank/withdrawal status | Expiring offer; assignment/status/location; delivery completed; earning/withdrawal events | Routing adapter; PostGIS; Cloudflare R2 proof; FCM | Driver `AppMockData` static orders, transactions, dashboard and mutable in-memory notifications; no server state or route provider | WP-11 | required_full | mock |
| Emergency SOS, triage, break-glass and independent dispatch | P-EMERGENCY; R-DISPATCH for `AMB-*` as conflicting UI evidence; W-EMERGENCY | Patient; emergency operator; responder/authorized driver; clinician under break-glass; admin | Create/cancel SOS; capture vital snapshot/location; triage; access with reason; dispatch/reassign unit; communicate; resolve | Active queue/map; event/timeline; vitals snapshot; fleet/shift; dispatch/ETA; communications; resolution/analytics | SOS raised/updated; triage/dispatch/location; break-glass audit; resolved | PostGIS/routing; Socket.IO; FCM; optional call channel | Patient and emergency portal mock UI; portal root/logs import `mockEmergencyCalls`; driver central mock incorrectly models ambulance work as ordinary `MockOrder` | WP-12 | required_full | mock |
| Finance, support, content, settings, audit, analytics and exports | W-FINANCE; W-SUPPORT; W-SETTINGS; W-CORE dashboard; D/P help/support; R earnings/withdrawal | Patient/doctor/driver requester; support agent; finance operator; admin/super-admin | Create/respond/assign/close ticket; publish FAQ/template/broadcast; process payout/withdrawal; change versioned setting/role; request export | Tickets/SLA; FAQ/content; transactions/ledgers/payouts; audit feed; dashboards/analytics; export job | Ticket/reply/SLA; payout; broadcast; setting/role changed; export ready | FCM; optional Resend; Cloudflare R2 exports; outbox worker | Portal `mockDashboardData`, `mockTransactions`, `mockPayouts`, `mockTickets`, `mockFAQs`, `mockNotifications` plus page-local data; browser audit/session behavior is not authoritative | WP-13 | required_full | mock |

## 5. Unregistered source screens

The feature-tree pass found 56 patient screen files, 22 doctor screen files and 21 driver screen files. Every doctor and driver screen is registered. Ten patient screen files are not reachable from `AppRouter`:

- Home alternatives: `home_screen.dart`, `home_screen_premium.dart`.
- IoT alternatives: `iot_device_discovery_screen.dart`, `pairing_successful_2_screen.dart`, `pairing_successful_3_screen.dart`, `pairing_successful_4_screen.dart`, `pairing_successful_5_screen.dart`, `pairing_successful_6_screen.dart`, `pairing_wizard_device_info_screen.dart`, `pairing_wizard_permissions_screen.dart`.

These files are implementation variants, not ten additional backend capabilities. They remain build inputs, however: `iot_device_discovery_screen.dart` and `pairing_successful_5_screen.dart` currently contribute analyzer errors. Client stabilization must choose a canonical screen and remove or repair each alternative without treating old UI variants as contract authority.

## 6. P0 semantic conflicts to resolve before contracts

| ID | Source evidence/conflict | Required canonical decision | Owner/work package | Status |
|---|---|---|---|---|
| CAP-P0-01 | Patient router starts at `/home`; all auth screens are bypassed. | Authentication guard, verified-session bootstrap, onboarding completion and offline-demo behavior. | WP-01 → WP-03 | selected in `enum-state-catalogue.md` v0.1 |
| CAP-P0-02 | Portal `RoleId` has only super-admin, admin, pharmacy, emergency and doctor; the accepted platform also has patient and driver memberships. Roles, fake tokens and permissions are client-generated. | Full membership catalogue, active-role rules, MFA/deactivation policy and server authority. Client arrays remain UX hints only. | WP-01 → WP-03 | selected in `policy-matrix.md` v0.1 |
| CAP-P0-03 | Portal uses mixed strings such as `pharmacy:order:read`; the target grammar is `resource[.subresource]:action[:scope]`. Portal scope matching is incomplete and `ROLE_HIERARCHY` comments imply unsafe inheritance semantics. | One grammar, seed catalogue, wildcard behavior and independent object-policy evaluation. | WP-01 → WP-03 | selected in `policy-matrix.md` v0.1 |
| CAP-P0-04 | Clients use doubles in ringgit, `in-person`, `upcoming`, route-generated transaction IDs and display strings as state. | Integer sen + `MYR`; canonical appointment modes/states; server IDs/timestamps; reschedule-as-replacement and idempotency rules. | WP-01 → WP-05 | selected in `enum-state-catalogue.md` v0.1 |
| CAP-P0-05 | Doctor permissions/UI imply prescription update, while signed prescriptions must be immutable. | Draft edit boundary, signing transition, superseding correction and PDF/version semantics. | WP-01 → WP-06 | selected in `enum-state-catalogue.md` v0.1 |
| CAP-P0-06 | Driver `MockOrder` merges pharmacy delivery and ambulance dispatch and exposes patient details before a server assignment. | Shared dispatch mechanics with separate delivery/emergency aggregates; expiring offer and minimum-necessary disclosure states. | WP-01 → WP-11/WP-12 | selected in `enum-state-catalogue.md` v0.1 |
| CAP-P0-07 | IoT mocks use free-text device/metric/unit/status values and commercial devices unrelated to the ESP32 prototype; connect/disconnect are no-ops. | Canonical metric/unit/quality vocabulary, assignment history, boot/sequence dedupe, threshold ownership and supported prototype hardware profile. | WP-01 → WP-07 | selected in `enum-state-catalogue.md` v0.1 |
| CAP-P0-08 | Patient UI presents generated “diagnoses,” confidence percentages and medication recommendations without provenance or doctor review. | Non-diagnostic wording, artifact/candidate states, provenance, safety filters, review/supersede flow and prohibited autonomous actions. | WP-01 → WP-08 | selected in `enum-state-catalogue.md` v0.1 |
| CAP-P0-09 | Several mobile detail routes have no resource ID and render hardcoded people/transactions; portal dynamic routes do carry IDs. | Required resource identifiers, not-found/forbidden behavior and deep-link ownership checks in generated contracts. | WP-01 | selected in `enum-state-catalogue.md` v0.1 |
| CAP-P0-10 | Current clients do not express organization/site ownership consistently. | Prototype organization/site topology and ownership defaults that preserve future scoped schema behavior. | WP-01 | selected in `policy-matrix.md` v0.1 |

## 7. Stage 0A disposition

- Route/screen inventory is complete for registered Flutter routes, Flutter feature screen files and portal page routes as of the baseline date.
- The matrix intentionally records UI evidence, not acceptance of unsafe mock semantics.
- All capabilities are `mock`; no client currently performs an authoritative backend query or command.
- No accepted route is labelled `future_not_committed`. Later full-platform capabilities are `required_full`; the FYP checkpoint capabilities are `required_fyp`.
- `policy-matrix.md` selects the initial membership, organization/site, session, MFA, permission and object-policy decisions for CAP-P0-02, CAP-P0-03 and CAP-P0-10.
- `enum-state-catalogue.md` selects identity bootstrap, canonical domain states, money, units, ordering, identifiers and idempotency rules for CAP-P0-01 and CAP-P0-04 through CAP-P0-09.
- No P0 capability-inventory decision remains unresolved. OpenAPI/AsyncAPI foundation contracts, one-year vitals capacity evidence, deterministic Dart/TypeScript generation, reviewed policy examples, domain/transaction diagrams and infrastructure/Firebase setting selections are complete. Backend scaffolding remains blocked only until the contract workflow confirms the local evidence on the remote repository.
