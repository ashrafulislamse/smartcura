# SmartCura Patient App — UI/UX Specification

> **Source basis:** Research synthesis from telemedicine apps (Teladoc, Practo, Halodoc, Doctor Anywhere), IoT health apps (Omron Connect, Withings Health Mate, Fitbit, Apple Health), compliance frameworks (WCAG 2.1 AA, HIPAA, GDPR), and Malaysia-local apps (BookDoc, DoctorOnCall).
> **Scope:** Patient app only. Doctor & Driver apps inherit the design system defined here.
> **Status:** Spec — not yet implemented. Redesign starts here.

---

## TABLE OF CONTENTS

- [Part 1 — Design System Foundation](#part-1--design-system-foundation)
- [Part 2 — Complete User Flow Map](#part-2--complete-user-flow-map)
- [Part 3 — Screen-by-Screen Specification](#part-3--screen-by-screen-specification)
  - [Flow A: Authentication & Onboarding](#flow-a-authentication--onboarding)
  - [Flow B: Home / Dashboard](#flow-b-home--dashboard)
  - [Flow C: Consultation (Find → Book → Pay → Call → Follow-up)](#flow-c-consultation)
  - [Flow D: Health & IoT Vitals](#flow-d-health--iot-vitals)
  - [Flow E: AI Symptom Checker](#flow-e-ai-symptom-checker)
  - [Flow F: Emergency / SOS](#flow-f-emergency--sos)
  - [Flow G: Pharmacy (NEW — entirely missing)](#flow-g-pharmacy)
  - [Flow H: Prescriptions](#flow-h-prescriptions)
  - [Flow I: Messages / Chat](#flow-i-messages--chat)
  - [Flow J: Profile & Medical ID](#flow-j-profile--medical-id)
- [Part 4 — Missing Screens Summary](#part-4--missing-screens-summary)
- [Part 5 — Research Sources](#part-5--research-sources)

---

## PART 1 — DESIGN SYSTEM FOUNDATION

### 1.1 Design Principles (research-backed)

| # | Principle | Source |
|---|---|---|
| 1 | **Compassion over data** — A racing heart rate is great for a runner, alarming for someone monitoring BP. Every vital must be shown in context, not as a raw number. | Withings / Fitbit UX team |
| 2 | **Health literacy first** — Plain language, no jargon. "No symptoms" not "asymptomatic". Text insights alongside charts (people comprehend text faster than complex charts). | Fitbit / DesignX |
| 3 | **The care flow is the product, not the video call** — Wrap the call in a clinical context layer: pre-call checks, in-call records access, post-call care plan. | TheFinch telemedicine guide |
| 4 | **Trust is the conversion metric** — Doctor verification badges prominent on profile (not in modals). Plain-language errors. Visible privacy controls. | Practo / India HealthTech trust |
| 5 | **Accessibility is clinical** — 14pt min font, 4.5:1 contrast, 48px touch targets, no color-only status indicators. Health users skew older and impaired. | WCAG 2.1 AA / Sanjay Dey |
| 6 | **Every screen has 4 states** — default, empty, loading, error. Empty states use clinical terms ("No active appointments" not "No data") + a next action. | Koruux / Taction |
| 7 | **Engagement ladder** — Join → Book → Attend → Follow instructions → Track → Return. Design for the whole ladder, not just booking. | TheFinch |

### 1.2 Color System

**Primary palette** (refine existing `app_colors.dart`):
- Primary: medical teal/blue (trust, clinical) — keep current `AppColors.primary`
- Secondary: warm accent (compassion, approachability)
- Surface: white / light gray `#F9FAFB` background
- Text: 3-level hierarchy (primary `#1F2937`, secondary `#6B7280`, disabled `#9CA3AF`)

**Clinical status colors** ⚠️ **MUST always pair color with text/icon label** (WCAG: no color-only indicators):
| Status | Color | Text label |
|---|---|---|
| Normal | Green `#10B981` | "Normal" + check icon |
| Warning | Amber `#F59E0B` | "Borderline" + alert icon |
| Critical | Red `#EF4444` | "High" / "Critical" + warning icon |
| Unknown/No data | Gray `#9CA3AF` | "No reading" + dash icon |
| Stale data | Muted blue | "Last updated [time]" + clock icon |

**Source state vs meaning state** (critical pattern from health dashboard research): separate "is the retrieval trustworthy?" from "what can we say about the value?". A successful network response doesn't imply medical interpretation. An error must never be shown as a zero.

### 1.3 Typography Scale

| Role | Size | Weight | Usage |
|---|---|---|---|
| Display | 28pt | 800 | Screen titles (rare) |
| H1 | 22pt | 700 | Screen headers |
| H2 | 18pt | 700 | Section headers |
| H3 | 16pt | 600 | Card titles |
| Body | 14pt ⬅ min | 400 | Default text |
| Body strong | 14pt | 600 | Emphasis |
| Caption | 12pt | 500 | Timestamps, meta |
| Label | 12pt | 600 | Buttons, tags |
| Vitals value | 32pt | 800 | HR/BP big numbers |

Font: keep Google Fonts (Poppins/Inter recommended — already wired via `google_fonts`). Never go below 14pt for body. Elderly users need 16pt+ for critical instructions.

### 1.4 Spacing & Touch Targets

- Base unit: 8px (existing `design_tokens.dart`). Scale: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- **Touch targets: minimum 48×48px** (WCAG 2.1 AA for health; Apple HIG is 44 — go bigger for health).
- Card padding: 16px. Screen padding: 16px (mobile). Section gap: 24px.

### 1.5 Component Library (build in `core/widgets/`)

Each component must ship with all 4 states. Build ONCE, reuse everywhere.

| Component | Variants / States |
|---|---|
| `PrimaryButton` | default, pressed, disabled, loading (spinner) |
| `SecondaryButton`, `TextButton` | same states |
| `CustomTextField` | empty, focused, filled, error (plain language msg), disabled |
| `PasswordField` | show/hide toggle, strength indicator |
| `VitalsCard` | normal/warning/critical/no-data/stale — color + label + icon |
| `DoctorCard` | with verified badge, rating, next-available, specialty chip |
| `EmptyState` | icon + headline (clinical term) + description + primary action |
| `LoadingState` | skeleton screen for known layouts, spinner for <3s |
| `ErrorState` | plain-language msg + retry + contact support |
| `TrustBadge` | "Verified" (MCI/PMC registration), "Encrypted", "HIPAA" |
| `StatusChip` | appointment status, online/offline, sync status |
| `ChatBubble` | patient/doctor/AI variants, timestamp, delivered/read |
| `PermissionRationale` | icon + why-we-need-this + grant/deny |
| `CountdownTimer` | for SOS, session timeout warning |
| `SessionWarningDialog` | "You'll be logged out in 60s" + extend / logout |

### 1.6 Accessibility Checklist (apply to EVERY screen)

- [ ] Contrast ratio ≥ 4.5:1 for body text, ≥ 3:1 for large text
- [ ] Touch targets ≥ 48×48px
- [ ] Body text ≥ 14pt
- [ ] No color-only status (always pair with text/icon)
- [ ] All interactive elements have ARIA/semantics labels
- [ ] Error messages announced to screen readers
- [ ] Session timeout warning ≥ 20 seconds before logout
- [ ] Auto-save on any form longer than 1 field
- [ ] No time-limited interactions for clinical actions (booking, entering vitals)
- [ ] Works at 200% zoom

---

## PART 2 — COMPLETE USER FLOW MAP

### Legend
- ✅ = exists in current app
- 🆕 = MISSING — must be added
- 🔧 = exists but needs redesign/fix

### Flow A — Authentication & Onboarding
```
Splash ✅ → Onboarding ✅ → Login ✅ → Signup ✅
   → 🆕 OTP/Phone Verification → 🆕 Email Verification
   → 🆕 Consent & Privacy (layered, plain language) → 🆕 Profile Setup (name, DOB, gender)
   → 🆕 Permission Rationale (notifications, camera, mic, location, Bluetooth)
   → Home
Forgot Password ✅ → 🆕 Reset Password (enter new password)
```

### Flow B — Home / Dashboard
```
Home ✅ (consolidate 3 versions → 1)
  ├─ Quick actions: Find Doctor, Emergency SOS, Pharmacy, AI Check
  ├─ Upcoming appointment card (if any) → Appointment Details
  ├─ Vitals snapshot (if IoT connected) → Health
  ├─ Recent activity / notifications → 🔧 Notifications ✅
  └─ Reorder medications (if any active Rx)
```

### Flow C — Consultation (the demo hero flow)
```
Find Doctor ✅ → 🔧 Doctor Search Filters 🆕 → Doctor Profile ✅
  → 🔧 Doctor Reviews List 🆕 → Book Appointment ✅
  → 🆕 Booking Confirmation (review before pay) → Payment ✅
  → Payment Success ✅ / Payment Failed ✅
  → Appointment Details ✅
  → 🆕 Pre-call Lobby (device check) → Video Consultation ✅ / Audio ✅
  → 🆕 Post-call Summary (care plan, what to track, escalation)
  → 🆕 Rate & Review Doctor → Prescription generated
Reschedule ✅ → Reschedule Success ✅
Cancel 🆕 (with reason) → 🆕 Cancel Confirmation
```

### Flow D — Health & IoT Vitals
```
Health ✅ → Enter Vitals ✅ (manual) → 🆕 Vitals History & Trends 🆕 (charts)
IoT: Discovery Hub ✅ → Select Device Type ✅ → Enable Permissions ✅
  → Establishing Connection ✅ → Pairing Success ✅
  → Sensor Calibration ✅ → 🆕 Live Readings Dashboard 🆕
  → 🆕 Device-specific History (BP trend, SpO2 trend)
  → 🆕 Alert Threshold Settings 🆕 (notify if BP > 140)
  → Firmware Update ✅ → Offline Data Sync ✅
  → Device Management ✅ → 🆕 Share Data with Doctor 🆕
```

### Flow E — AI Symptom Checker
```
🆕 Symptom Input (chat or chips) → 🆕 AI Analyzing (loading)
  → Smart Diagnosis Summary 1 ✅ → Summary 2 ✅ → Summary 3 ✅
  → 🆕 Action: Book Doctor from recommendation → Find Doctor
  → 🆕 Diagnosis History 🆕
```

### Flow F — Emergency / SOS
```
Emergency SOS ✅ → 🆕 SOS Countdown (5s cancel window) → 🆕 SOS Active Status
  → 🆕 Ambulance Tracking Map 🆕 (ETA, live location)
  → 🆕 SOS Resolved / Cancelled
Emergency Contacts Setup ✅ → 🆕 Add/Edit Contact 🆕
🆕 SOS History 🆕
```

### Flow G — Pharmacy (ENTIRELY NEW)
```
🆕 Pharmacy Home (search + categories + Rx on file)
  → 🆕 Medicine Search → 🆕 Medicine Details
  → 🆕 Cart → 🆕 Checkout (upload Rx, address, payment)
  → 🆕 Order Confirmation → 🆕 Order Tracking 🆕
  → 🆕 Order History 🆕
  → 🆕 Refill from past order
```

### Flow H — Prescriptions
```
Prescriptions List ✅ → Prescription Details ✅
  → 🆕 PDF Viewer / Share 🆕 → 🆕 Refill Request 🆕
  → 🆕 Medication Reminders 🆕 (schedule + push)
```

### Flow I — Messages / Chat
```
Messages List ✅ → Doctor Chat ✅ / AI Chat ✅
  → 🆕 Attachment / Image share 🆕
  → 🆕 Start video call from chat 🆕
  → 🆕 Chat Search 🆕
```

### Flow J — Profile & Medical ID
```
Profile ✅ → Edit Profile ✅ → Settings ✅
  → 🔧 Medical ID Intro ✅ → 🆕 ACTUAL Medical ID screen 🆕 (the intro leads nowhere now)
  → Notification Preferences ✅ → Help & Support ✅
  → 🆕 Privacy Dashboard 🆕 (granular consent, what's shared, audit log)
  → 🆕 Payment Methods / Wallet 🆕
  → 🆕 Billing / Invoice History 🆕
  → 🆕 Family / Dependent Profiles 🆕
  → 🆕 Terms & Privacy Policy 🆕
  → 🆕 Delete Account / Data Export 🆕 (GDPR)
  → 🆕 Logout 🆕 (clear, accessible)
```

---

## PART 3 — SCREEN-BY-SCREEN SPECIFICATION

Format per screen:
- **Route** • **Purpose** • **Layout** • **States** • **Trust/Accessibility** • **Research basis**

### Flow A: Authentication & Onboarding

#### A1. Splash Screen — `splash_screen.dart` ✅
- **Purpose:** Brand impression, app init. ≤2 seconds.
- **Layout:** Full-bleed brand gradient (teal→blue), centered logo + tagline "Your Healthcare Companion", subtle loading indicator.
- **States:** Loading (spinner) → redirect to onboarding (first launch) or login (returning).
- **A11y:** Logo has semantic label "SmartCura logo". No auto-advance faster than 2s (cognitive load).
- **Research:** Teladoc keeps splash minimal; brand trust starts here.

#### A2. Onboarding — `onboarding_screen.dart` ✅ 🔧
- **Purpose:** Explain value before asking for anything. 3–4 slides max.
- **Layout:** Top: illustration (people, not abstract). Middle: headline + 1-line description. Bottom: page dots + Skip + Next.
- **Slides:** (1) Consult doctors anytime (2) Monitor vitals from home (3) Pharmacy delivered to you (4) 24/7 emergency support.
- **States:** Last slide changes "Next" → "Get Started".
- **Research:** TheFinch — "get users to a meaningful action fast, ask only essential info upfront." Practo — onboarding should reduce drop-off, not add friction.
- **Fix:** Current version exists; verify it's ≤4 slides and has Skip.

#### A3. Login — `login_screen.dart` ✅ 🔧
- **Purpose:** Fast re-entry for returning users.
- **Layout:** Top: logo + "Welcome back". Middle: email/phone field, password field (show/hide), "Remember me" checkbox, "Forgot password?" link. Bottom: "Sign In" primary button, "Don't have an account? Sign up" text button. Optional: biometric prompt (Face ID/fingerprint) for returning users.
- **States:** Empty fields → helper text. Error → plain language ("That email doesn't match an account. Try again or sign up."). Loading → button shows spinner.
- **Trust:** Small lock icon + "Bank-grade encryption" near submit.
- **A11y:** Fields labeled, error announced to screen reader, 48px targets.
- **Research:** DesignX — biometric with clear feedback ("Face ID successful"). Sanjay Dey — step-up auth only for sensitive actions, standard login here.

#### A4. Signup — `signup_screen.dart` ✅ 🔧
- **Purpose:** Create account. Minimal fields — name, phone, email, password, DOB.
- **Layout:** Progress indicator (Step 1 of 4). One concept per step. "Why we ask" link next to each sensitive field.
- **States:** Real-time field validation (on blur, not on every keystroke). Password strength meter.
- **Research:** HIPAA UX — "explain why for sensitive fields in one line". Layered consent, not a wall.

#### A5. 🆕 OTP / Phone Verification — MISSING
- **Purpose:** Verify phone number (driver app has this; patient doesn't).
- **Layout:** Top: "Enter the 6-digit code sent to +60 12-345 6789". Middle: 6 separate input boxes (auto-advance). Bottom: "Resend code in 0:30" countdown → becomes "Resend code" link.
- **States:** Wrong code → "That code isn't right. Check and try again." with "Resend" highlighted. Expired → "Code expired. We sent a new one."
- **A11y:** Single-code-entry fallback option for screen readers (one input, not 6 boxes).
- **Research:** Driver app already has `otp_verification_screen.dart` — port the pattern. Standard for SEA apps.

#### A6. 🆕 Email Verification — MISSING
- **Purpose:** Confirm email ownership.
- **Layout:** "We sent a link to a***@email.com. Tap it to verify." + "Open email app" button + "Resend" + "Change email".
- **Research:** Teladoc requires identity verification before booking.

#### A7. 🆕 Consent & Privacy (Layered) — MISSING (critical for HIPAA/GDPR)
- **Purpose:** Informed consent, not a legal wall.
- **Layout:** Card-based, one topic per card: (1) "We collect your health info to provide care" — toggle (2) "Share with your chosen doctors" — toggle (3) "Send appointment reminders" — toggle (4) "Use anonymized data to improve the app" — toggle (off by default). Each card: 1-line plain explanation + "Read full policy" link.
- **States:** Cannot proceed until required toggles on. Disabled "Continue" until minimum consent.
- **Trust:** "You can change these anytime in Settings → Privacy."
- **Research:** SimplyMed — "layered: short summary + expandable detail. No pre-checked boxes. Separate consent for unrelated activities." Sanjay Dey — "6th grade reading level." India DPDPA + GDPR — granular consent mandatory.

#### A8. 🆕 Profile Setup — MISSING
- **Purpose:** Capture essentials for care (DOB, gender, blood group, existing conditions, allergies).
- **Layout:** Step form. Blood group + allergies flagged as "Used by emergency responders — see Medical ID."
- **Research:** Apple Medical ID collects these; flagged for emergency use builds trust.

#### A9. 🆕 Permission Rationale Screens — MISSING
- **Purpose:** Explain why each permission is needed BEFORE the system prompt (increases grant rate).
- **Layout:** Full-screen, one permission: icon + "SmartCura needs [permission] to [purpose]" + "Allow" / "Maybe later". Sequence: Notifications → Camera → Microphone → Location → Bluetooth (for IoT).
- **Example copy:** "SmartCura needs Bluetooth to connect your blood pressure monitor and receive readings. Your data stays encrypted." 
- **Research:** Apple Health HIG — "request access only when needed, in-context, with descriptive messages." Android Health Connect — "Consistency, Transparency, Clarity."

#### A10. Forgot Password — `forgot_password_screen.dart` ✅ 🔧
- **Purpose:** Trigger reset.
- **Layout:** Email/phone field → "Send reset link/code". Success state: "Check your email — we sent a link."

#### A11. 🆕 Reset Password — MISSING
- **Purpose:** Enter new password after clicking reset link / entering OTP.
- **Layout:** New password + confirm password + strength meter → "Password updated" → redirect to login.
- **Current gap:** Forgot Password exists but there's no screen to actually enter the new password.

---

### Flow B: Home / Dashboard

#### B1. Home — `home_screen_v2.dart` ✅ 🔧 (delete `home_screen.dart` + `home_screen_premium.dart` — orphaned)
- **Purpose:** Daily landing. Surface the 3–4 actions that matter, nothing more.
- **Layout (top→bottom):**
  1. **Greeting bar:** "Good morning, [name]" + notification bell (badge count) + profile avatar
  2. **Emergency banner** (if no Medical ID set): "Add your Medical ID for emergencies" → dismissible
  3. **Next appointment card** (if any): doctor name, time, "Join" button (appears 10 min before) → pre-call lobby. Empty state: "No upcoming appointments. Find a doctor →"
  4. **Quick action grid (4 tiles):** Find Doctor, Pharmacy, AI Symptom Check, Emergency SOS
  5. **Vitals snapshot** (if IoT paired): latest HR, SpO2, Temp in 3 mini `VitalsCard`s with status color + label. "View trends →"
  6. **Active prescriptions** (if any): "3 medications — next dose 2:00 PM" → reminders
- **States:** Empty (new user) → onboarding-style prompts to add Medical ID, pair device, book first consult. Loading → skeleton cards. Error → "Couldn't load your dashboard. Pull down to refresh."
- **Research:** TheFinch — "surface critical actions prominently from the moment app opens. Booking should be 2-3 taps." Sanjay Dey — "fastest path to the right action is a clinical decision."

#### B2. Notifications — `notifications_screen.dart` ✅ 🔧
- **Purpose:** Central notification center.
- **Layout:** Grouped by date (Today / Earlier). Each: icon + title + body + time + tap action. Swipe to dismiss/archive.
- **States:** Empty → "No notifications yet. You'll see appointment reminders and health alerts here."
- **Research:** Taction — "Don't lose notifications when dismissed. Critical alerts cannot be permanently silenced."

---

### Flow C: Consultation

#### C1. Find Doctor — `find_doctor_screen.dart` ✅ 🔧
- **Purpose:** Search + filter doctors.
- **Layout:** Top: search bar (animated placeholder cycling: "Search by symptom, specialty, or name"). Below: specialty chips (horizontal scroll). Below: doctor cards list (avatar, name, verified badge, specialty, rating + review count, next available, fee). Sort: "Soonest available" / "Top rated" / "Lowest fee".
- **States:** Empty search → "No doctors found. Try a different symptom or specialty." Loading → skeleton list.
- **Research:** Practo — animated search bar, symptom→specialty matching with visual cues (green tick when doctor treats symptom), trending/recent searches. **Fix:** current screen exists but no filter — add filter sheet.

#### C2. 🆕 Doctor Search Filters — MISSING
- **Purpose:** Refine search.
- **Layout:** Bottom sheet. Sections: Specialty (multi-select chips), Consultation type (video/audio/in-person), Availability (today/tomorrow/this week), Fee range (slider), Language spoken, Gender preference (female doctor option — cultural in SEA). "Apply" + "Reset".
- **Research:** Halodoc redesign — filters were a pain point ("buttons looked similar"). BookDoc — search by category. Cultural: female-doctor preference matters in SEA/Malaysia.

#### C3. Doctor Profile — `doctor_profile_screen.dart` ✅ 🔧
- **Purpose:** Build trust + book.
- **Layout:** Top: photo + name + **verified badge prominent** (PMC/MCI registration number, "Tap to verify" → external registry link). Specialty, experience, hospital, languages. About (expandable). Consultation fee + "Book Appointment" sticky CTA. Stats: rating, review count, consultations completed. **Reviews section preview** (top 2 reviews + "See all reviews →").
- **Trust:** Verification badge MUST be on profile screen, not in a modal (Practo/India trust research — patients decide based on this screen).
- **Research:** Productgrowth.in — "MCI registration number linked to public registry so patients can self-verify. Number of consultations completed = social proof."

#### C4. 🆕 Doctor Reviews List — MISSING
- **Purpose:** Read patient feedback before booking.
- **Layout:** Filter (rating stars, recent, verified consultations only). List of review cards: patient initials, rating, date, text, "Helpful" count. 
- **Research:** Practo/Practo redesign Behance — "unified medical records + reviews."

#### C5. Book Appointment — `book_appointment_screen.dart` ✅ 🔧
- **Purpose:** Pick slot + consultation type.
- **Layout:** Top: "Book appointment with Dr. [name]". Care intent selector: New consultation / Follow-up / Prescription renewal / Second opinion (chips). Date picker (calendar, next 30 days, available days highlighted). Time slots (morning/afternoon/evening groups, "Soonest available" recommended-first). Consultation type: Video / Audio / In-person (with fee shown). Optional: symptom chips + severity + notes upload. Sticky bottom: "Review booking →".
- **Research:** TheFinch — "clear care intent, smart slot nudges (soonest available, same-day), lightweight pre-check (symptom chips, severity)." Halodoc — slot picker was a pain point.

#### C6. 🆕 Booking Confirmation — MISSING
- **Purpose:** Review before payment (reduces pre-payment anxiety).
- **Layout:** Summary card: doctor, date, time, type, fee. "What happens next: [1] Join 5 min before [2] Consult for ~20 min [3] Get digital prescription." "Proceed to payment" + "Edit".
- **Research:** Productgrowth.in — "explain the process explicitly before asking for payment. 'Here's what a 20-minute consultation looks like...' reduces pre-booking anxiety."

#### C7. Payment — `payment_screen.dart` ✅ 🔧
- **Purpose:** Pay securely.
- **Layout:** Amount breakdown (consultation fee, platform fee, total). Payment methods: **Card, FPX Online Banking (Maybank2u, CIMB Clicks, RHB), e-Wallet (Touch'n Go, GrabPay, Boost, ShopeePay)**. "Pay securely" button with lock icon.
- **Trust:** "Your payment is encrypted. We don't store card details."
- **Research:** DoctorOnCall — accepts Online Banking, Credit Card, e-Wallets (Boost, GrabPay). Malaysia-standard methods.

#### C8. Payment Success / Failed — `payment_success_screen.dart` ✅ / `payment_failed_screen.dart` ✅ 🔧
- **Success:** Checkmark animation, amount, transaction ID, "Add to calendar" + "View appointment". 
- **Failed:** Plain language ("Payment didn't go through. No money was taken. Try again or use a different method.") + Retry + Contact support.

#### C9. Appointment Details — `appointment_details_screen.dart` ✅ 🔧
- **Purpose:** View/manage a booking.
- **Layout:** Doctor card, date/time, type, status chip. Actions: Reschedule, Cancel (with reason), Join (when active). Pre-consultation checklist (have meds ready, find quiet space, test camera).
- **Research:** Teladoc — "prepare like an in-person visit. Medication list, allergies, recent readings."

#### C10. 🆕 Pre-call Lobby — MISSING (critical for video UX)
- **Purpose:** Device check + reduce no-shows.
- **Layout:** "Your consultation starts in 4:32" countdown. Device check: camera preview (selfie), mic test (speak → waveform reacts), connection strength. "Doctor will join shortly — they're finishing a previous consult (est. 2-5 min)." Pre-fill: symptoms summary, recent vitals (auto-pulled from IoT). Fallback buttons: "Switch to audio" / "Chat support".
- **Research:** TheFinch — "waiting room must answer: confirmed? when will clinician join? what to prepare? fallbacks?" Teladoc — "tech check 15 min early, confirm Wi-Fi, test audio." Productgrowth.in — "active waiting room showing doctor status + ETA."

#### C11. Video Consultation — `video_consultation_screen.dart` ✅ 🔧 (FIX hardcoded doctor name)
- **Purpose:** The consultation itself.
- **Layout:** Main video (doctor), PiP self-view. Top: call timer, connection indicator, encryption icon. Bottom controls: mute, camera toggle, flip camera, chat, "View my vitals" (side sheet pulls in latest readings to share), end call (red, with "Are you sure?" confirm).
- **Fix:** Route currently hardcodes `doctorName: 'Dr. Sarah Bennett'` — must receive real doctor from `bookingStateProvider`.
- **Research:** TheFinch — "video is not the product, the care flow is. In-call access to reports, notes, photos without breaking the flow."

#### C12. Audio Consultation — `audio_consultation_screen.dart` ✅ 🔧 (same hardcoded name fix)
- Same as video but audio-only with doctor photo + animated waveform.

#### C13. 🆕 Post-call Summary — MISSING (high engagement impact)
- **Purpose:** Turn the call into follow-through.
- **Layout:** "Your care plan (today)" — action items (checkboxes). "What to track this week" — metrics to log (links to vitals entry). "If you feel worse" — clear escalation pathway + emergency button. "Your prescription is ready →" (if issued). "Book a follow-up in one tap" CTA. "Rate your consultation" stars.
- **Microcopy:** "Your summary is saved. You can return anytime."
- **Research:** TheFinch — "post-call screen: care plan + what to track + escalation. Microcopy: 'Your summary is saved. Book a follow-up in one tap if symptoms continue.'" Productgrowth.in — "post-consultation follow-up check-ins drive retention."

#### C14. 🆕 Rate & Review Doctor — MISSING
- **Purpose:** Collect feedback (your `Doctor.rating`/`reviewCount` fields are never written to).
- **Layout:** Star rating (1-5), optional text, tags ("Good listener", "On time", "Clear explanation"). Submit. "Your review helps other patients."
- **Research:** Practo — reviews drive booking decisions; your model has the fields, just no UI to write them.

#### C15. Reschedule — `reschedule_appointment_screen.dart` ✅ / `reschedule_success_screen.dart` ✅
- Keep. Add reason field (optional).

#### C16. 🆕 Cancel with Reason — MISSING
- **Layout:** Reason chips (scheduling conflict, feeling better, found another doctor, other + text). "Cancel appointment" confirm. Plain-language outcome: "Appointment cancelled. No charge was applied."

---

### Flow D: Health & IoT Vitals

#### D1. Health — `health_screen.dart` ✅ 🔧
- **Purpose:** Hub for all health data.
- **Layout:** Top: "Your Health" + date range selector (Day/Week/Month/Year). Vitals cards grid: HR, SpO2, BP, Temp, Weight, Glucose — each a `VitalsCard` with latest value + status color + label + sparkline + "Last updated [time] from [source]". Below: "Log vitals manually" + "Pair a device" CTAs. Below: health timeline (chronological events).
- **States:** No data → empty state per vital ("No heart rate readings yet. Pair a device or log manually →").
- **Research:** Withings — "Dashboard is where you see trends over weeks/months/years. Color-coded." Omron — "color-coded results so you immediately identify changes." Health dashboard article — "each card has a source state (current/stale/disconnected/error) + meaning state (reported/missing)."

#### D2. Enter Vitals — `enter_vitals_screen.dart` ✅ 🔧
- **Purpose:** Manual entry fallback.
- **Layout:** Choose vital type (chips). Numeric input with unit. Date/time (default now). Optional note. "Save". Range validation (BP can't be 400, HR can't be 300) with plain-language warning.
- **Research:** Taction — "range checking for vital signs = error prevention."

#### D3. 🆕 Vitals History & Trends — MISSING (high value, `fl_chart` already in pubspec)
- **Purpose:** See progress over time (the whole point of tracking).
- **Layout:** Full-screen chart for one vital. Time range tabs (1W / 1M / 3M / 1Y). **Chart type per vital:** BP = dual-line (systolic/diastolic) with target zone shading; HR = line with resting/exercise zones shaded; SpO2 = line with 95-100% normal band; Temp = line with normal 36.1-37.2°C band; Glucose = line with fasting/post-meal bands. **Text insight header above chart** ("Your resting HR averaged 72 bpm this week — within normal range."). Tappable points → detail popover (value, time, source, note). Export PDF/CSV.
- **Research:** Fitbit — "chart headers: people comprehend text-based insight easier than complex chart. Visual + text work as a system." Withings — "compare with population by age/condition." Omron — "PDF export via email."

#### D4. Live IoT Readings (paired device screens) — D5-D11 IoT pairing screens exist ✅
- IoT pairing flow (16 screens, 7 orphaned — delete `pairing_successful_2`–`_6`, `pairing_wizard_*`) is thorough. Keep the routed ones.

#### D5. 🆕 Live Readings Dashboard — MISSING (where ESP32 data lands)
- **Purpose:** Real-time vitals from your DIY wearable + paired Omron.
- **Layout:** Connected devices strip (top, horizontal scroll — name, battery, signal, last sync). Live reading cards: HR (big number + live updating), SpO2 (%), Temp (°C). Each card: value + status color + label + "live" pulse indicator + "Last updated 5s ago". Sync status banner ("Syncing... 3 of 5 readings" / "All synced" / "Offline — 12 readings queued").
- **States:** Disconnected → "Device disconnected. Reconnect →". Stale (>5 min) → muted + "Last reading 12 min ago". Error → "Couldn't read from device. Retry →".
- **Research:** Withings heart rate view — context is key. Health dashboard article — separate source state from meaning state. Omron — sync indicators.

#### D6. 🆕 Alert Threshold Settings — MISSING
- **Purpose:** Personalized notifications.
- **Layout:** Per-vital toggle + range sliders ("Notify me if BP above [140]/[90]" / "HR below [50] or above [120] while resting" / "SpO2 below [95]" / "Temp above [37.5]"). "Save".
- **Research:** Withings — "High and Low Heart Rate alerts suggested by doctors. 50-100 bpm resting range." Omron — "set personal targets, monitor progress."

#### D7. 🆕 Share Data with Doctor — MISSING
- **Purpose:** Send readings to your doctor before/during consultation.
- **Layout:** Select doctor (from past consultations) → select time range → "Share securely" → confirmation. Doctor sees it in their patient detail screen.
- **Research:** Omron — "share with physicians/caregivers." Productgrowth.in — "real-time vitals input if patient has a health device."

---

### Flow E: AI Symptom Checker

#### E1. 🆕 Symptom Input — MISSING (AI flow has no entry point currently)
- **Purpose:** Describe symptoms before AI analyzes.
- **Layout:** Chat-style or chip-based. "What's bothering you today?" Text input + suggested symptom chips (fever, headache, cough, fatigue, chest pain...). Body part selector (tap on body illustration). Duration selector ("How long? Today / 3 days / a week / longer"). Severity slider (1-10). "Analyze" button.
- **Research:** Practo — symptom→specialty matching. TheFinch — "lightweight pre-check: symptom chips, severity."

#### E2. 🆕 AI Analyzing — MISSING
- **Loading state:** "Analyzing your symptoms..." with animated pulse + reassurance ("This is not a diagnosis. Always consult a doctor for medical advice.")
- **Trust:** Clear disclaimer — AI is informational, not a replacement for a doctor.

#### E3-E5. Smart Diagnosis Summary 1/2/3 — ✅ (keep, wire entry from E1)
- **Fix:** These screens exist but aren't reachable from a symptom input. Add E1 → E2 → E3 flow. Add "Consult Dr. [name]" action button that navigates to Find Doctor (currently the recommendation cards don't navigate anywhere).

#### E6. 🆕 Diagnosis History — MISSING
- **Purpose:** Review past AI analyses.
- **Layout:** List of past diagnoses (condition, date, confidence, risk level) → tap to reopen summary.

---

### Flow F: Emergency / SOS

#### F1. Emergency SOS — `emergency_sos_screen.dart` ✅ 🔧
- **Purpose:** Trigger emergency.
- **Layout:** Big red SOS button (hold-to-activate, not tap — prevents accidental). **5-second countdown** with cancel ("Hold to cancel"). On activate: haptic + sound + "Calling emergency services + notifying [contact name]".
- **Research:** DesignX — "Visual + audio + haptic. Cannot be easily dismissed. Escalation if not acknowledged."

#### F2. 🆕 SOS Active Status — MISSING
- **Purpose:** Reassurance after pressing SOS.
- **Layout:** "Help is on the way." Status timeline: ✓ SOS sent → ✓ Contact notified → ⏳ Ambulance dispatched → ⏳ En route → ⏳ Arrived. Cancel button (with reason: "I'm safe / false alarm / situation resolved"). Share live location toggle.

#### F3. 🆕 Ambulance Tracking Map — MISSING (`google_maps_flutter` is in pubspec, unused here)
- **Purpose:** See the ambulance coming (the headline emergency feature).
- **Layout:** Full-screen Google Map. Patient pin (blue) + ambulance pin (red, moving). ETA banner ("Arriving in ~8 min"). Driver name + call button. Route line.
- **Research:** Your `ApiConstants.ambulanceTracking` endpoint exists; no UI. This is the dramatic demo moment.

#### F4. Emergency Contacts Setup — `emergency_contacts_setup_screen.dart` ✅ 🔧
- **Purpose:** Manage contacts.
- **Layout:** List of contacts (name, relationship, phone). Add (max 5 per `AppConstants.maxEmergencyContacts`) / edit / delete. Reorder (priority).

#### F5. 🆕 SOS History — MISSING
- **Purpose:** Past emergencies.
- **Layout:** List (date, outcome, resolved/cancelled) → detail.

---

### Flow G: Pharmacy

> ⚠️ ENTIRE FLOW MISSING. The `pharmacy/` folder is empty. `ApiConstants` defines the endpoints. This is a stated feature with zero UI.

#### G1. 🆕 Pharmacy Home
- **Purpose:** Search medicines + see Rx on file.
- **Layout:** Search bar (medicine name or condition). Categories (cold & flu, vitamins, first aid, prescription, chronic care). "Prescriptions on file" section (upload Rx or use doctor's e-prescription). Cart icon (badge).

#### G2. 🆕 Medicine Search & Details
- **Search:** Autocomplete list (name, generic name, brand, image, price, Rx-required badge).
- **Details:** Image, name, generic, uses, dosage, side effects, warnings, **halal/registration info** (Malaysia context), price, stock status, "Add to cart". Rx-required → prompt upload.

#### G3. 🆕 Cart & Checkout
- **Cart:** Items, qty, subtotal, delivery fee, total. Rx upload for Rx items. Delivery address (saved addresses + add new). Payment (same methods as consultation). "Place order".

#### G4. 🆕 Order Tracking
- **Layout:** Status timeline (Confirmed → Packed → Picked up → Out for delivery → Delivered). Live courier location (map, if available). ETA. Contact courier.

#### G5. 🆕 Order History & Refill
- **List:** Past orders (date, items, total, status). Tap → detail + "Reorder/refill".

---

### Flow H: Prescriptions

#### H1. Prescriptions List — `prescriptions_list_screen.dart` ✅ 🔧
- **Layout:** List (date, doctor, medications count, status). Filter (active/past). Empty → "No prescriptions yet. You'll get one after your next consultation."

#### H2. Prescription Details — `prescription_details_screen.dart` ✅ 🔧
- **Layout:** Doctor info, date, medications (name, dosage, frequency, duration, instructions). Actions: 🆕 View PDF, 🆕 Share (email/WhatsApp to pharmacy), 🆕 Request Refill, 🆕 Set Medication Reminders, 🆕 Order from Pharmacy (→ G1 cart).

#### H3. 🆕 PDF Viewer / Share — MISSING
- **Purpose:** Download/share prescription.
- **Layout:** PDF render + share sheet (WhatsApp, email, print). `pdf` package is in doctor app's deps — add to patient app.

#### H4. 🆕 Medication Reminders — MISSING
- **Purpose:** Adherence.
- **Layout:** Per-medication: schedule (times per day), dose, with/without food. Toggle reminders. Push notifications. "Mark as taken" log. Adherence streak.

---

### Flow I: Messages / Chat

#### I1. Messages List — `messages_list_screen.dart` ✅ 🔧
- **Layout:** Conversations (avatar, name, last message, time, unread badge). Filter: All / Doctors / AI Assistant. Search. Empty → "No conversations yet. Start one from a doctor's profile or ask the AI assistant."

#### I2. Doctor Chat — `doctor_chat_screen.dart` ✅ 🔧
- **Layout:** Message bubbles (patient right, doctor left), timestamps, read receipts. Input bar: text + 🆕 attach (image/photo — for showing rash, lab report) + 🆕 "Start video call" icon. **Secure messaging indicator** (lock icon + "Encrypted").
- **Research:** Productgrowth.in — "secure messaging indicators make encrypted comms visually distinct."

#### I3. AI Chat — `ai_chat_screen.dart` ✅ 🔧
- **Layout:** Chat with AI assistant. Disclaimer banner ("AI assistant — not a doctor. For emergencies call 999."). Quick reply chips. Can escalate to "Book a doctor" → Find Doctor.

---

### Flow J: Profile & Medical ID

#### J1. Profile — `profile_screen.dart` ✅ 🔧
- **Layout:** Avatar + name + email + edit. Menu list: Medical ID, Privacy, Payment Methods, Billing, Family Profiles, Notification Preferences, Help & Support, Terms, **Logout** (🆕 — currently missing/unclear).

#### J2. Edit Profile — `edit_profile_screen.dart` ✅ 🔧
- Standard form. Avatar upload (camera/gallery). Verify phone/email status badges.

#### J3. Settings — `settings_screen.dart` ✅ 🔧
- **Layout:** Language (🆕 English / Bahasa Malaysia / 中文 / தமிழ் — Malaysia), Dark mode toggle, Notifications, Data & Storage, About, Logout.

#### J4. 🔧 Medical ID Intro → 🆕 ACTUAL Medical ID — CRITICAL GAP
- **Current:** `medical_id_intro_screen.dart` exists but leads nowhere.
- **New Medical ID screen:** Layout — sections: Blood group, Allergies (chips + custom), Conditions (chips + custom), Medications (list), Organ donor toggle, Emergency contacts (name + relationship + phone), Insurance (optional). **"Show on lock screen" toggle** (critical — first responders access without unlock). **"Share during emergency call" toggle**. Preview "How responders see it".
- **Research:** Apple Medical ID — lock screen access, share during emergency call. RespondrID/MedID/EmergencyID — all emphasize lock-screen access + offline + encrypted.

#### J5. Notification Preferences — `notification_preferences_screen.dart` ✅ 🔧
- **Layout:** Granular toggles: Appointment reminders, Medication reminders, Vitals alerts, AI insights, Promotions (off by default). "Critical alerts cannot be silenced" note.

#### J6. Help & Support — `help_support_screen.dart` ✅ 🔧
- **Layout:** FAQ (searchable + accordions), Contact (chat / call / email), Report a problem, Feedback.

#### J7. 🆕 Privacy Dashboard — MISSING (GDPR/HIPAA)
- **Purpose:** Transparency + control.
- **Layout:** "What data we have" (categories). "Who can see it" (you, your doctors, emergency responders). Consent toggles (re-manage from A7). **Audit log** ("Dr. Smith viewed your records on 12 Jan 2026" — your web portal has audit logging; expose it to patients). "Download my data" + "Delete my account" (with confirmation + grace period).

#### J8. 🆕 Payment Methods / Wallet — MISSING
- **Purpose:** Manage saved cards + e-wallets.
- **Layout:** Saved methods (masked), add/remove, default. Transaction history (consultations, pharmacy orders).

#### J9. 🆕 Family / Dependent Profiles — MISSING
- **Purpose:** Manage parents/children's health (common in SEA).
- **Layout:** List of family members. Add (name, DOB, relation, their Medical ID). Switch profile to view their data. 
- **Research:** RespondrID — "family profiles, manage elderly parents + children, switch instantly."

#### J10. 🆕 Terms & Privacy Policy — MISSING (legally required)
- **Layout:** Searchable, scannable, chunked by section ("What we collect", "How we use it", "Who we share with", "Your choices", "Contact"). Not a wall of legalese.

#### J11. 🆕 Delete Account / Data Export — MISSING (GDPR right to erasure)
- **Layout:** "Download all your data" (generates ZIP within 30 days). "Delete my account" → confirmation + reason + grace period (30 days to cancel) → permanent deletion notice.

#### J12. 🆕 Logout — MISSING/unclear
- **Layout:** In settings/profile menu. Confirmation ("You'll need to sign in again. Your data is saved."). Clear session.

---

## PART 4 — MISSING SCREENS SUMMARY

### Critical (flow is broken without them)
| Screen | Flow | Why critical |
|---|---|---|
| OTP/Phone Verification | Auth | No phone verification = non-starter |
| Reset Password | Auth | Forgot password leads nowhere |
| Consent & Privacy | Auth | Legally required (HIPAA/GDPR) |
| Permission Rationale | Auth | Low permission grant rate without |
| Medical ID (actual) | Profile | Intro leads nowhere |
| Symptom Input | AI | AI flow has no entry point |
| Pre-call Lobby | Consult | No-shows, tech failures |
| Post-call Summary | Consult | Care plan = engagement |
| Pharmacy (all 5) | Pharmacy | Entire stated feature missing |
| Ambulance Tracking | Emergency | Headline emergency feature |
| Chat screen (Doctor app) | Doctor | Messages list is dead end |
| Schedule Editor (Doctor app) | Doctor | Appointments can't be booked |
| Document Upload (Doctor app) | Doctor | Can't onboard real doctors |

### Important (flow works but incomplete)
| Screen | Flow |
|---|---|
| Doctor Search Filters | Consult |
| Doctor Reviews List | Consult |
| Booking Confirmation | Consult |
| Rate & Review Doctor | Consult |
| Cancel with Reason | Consult |
| Vitals History & Trends | Health |
| Live Readings Dashboard | IoT |
| Alert Threshold Settings | IoT |
| Share Data with Doctor | IoT |
| Diagnosis History | AI |
| SOS Active Status | Emergency |
| SOS History | Emergency |
| PDF Viewer / Share | Prescriptions |
| Medication Reminders | Prescriptions |
| Privacy Dashboard | Profile |
| Payment Methods | Profile |
| Family Profiles | Profile |
| Delete Account | Profile |
| Logout | Profile |
| Terms & Privacy | Profile |

### Cleanup (delete — orphaned dead code)
- `home_screen.dart`, `home_screen_premium.dart` (only `home_screen_v2` is routed)
- `iot_device_discovery_screen.dart` (only `_hub` is routed)
- `pairing_successful_2` through `pairing_successful_6` (only `_1` is routed)
- `pairing_wizard_device_info_screen.dart`, `pairing_wizard_permissions_screen.dart`
- Empty folders: `appointments/` (patient), `pharmacy/` (patient — will be filled by Flow G)

---

## PART 5 — RESEARCH SOURCES

### Telemedicine app UX
- TheFinch — "Telemedicine App UI/UX Design Best Practices" (thefinch.design)
- Practo UX case study — Medium (srirammanogar07) — search flow drop-off
- Halodoc booking redesign — Medium (Sumayya Tsabitah) — 20+ screen flow
- Practo redesign — Behance — simplified booking, unified records
- Teladoc virtual visit workflow — Medispress
- Doctor-patient platform trust (India) — productgrowth.in — verification badges, waiting room, post-consult follow-up

### IoT / connected health apps
- Omron Connect — omronconnect.com, omron-healthcare.com — color-coded BP, diary, PDF/CSV export, Bluetooth pairing (P/O modes), premium tiers
- Withings Health Mate — aurelienmarrast.com (designer case study) + wareable.com — HR context (resting vs exercise), population comparison, alerts, 5 sections (Timeline/Dashboard/Leaderboard/Profile/Reminders), Maze testing
- Fitbit (Google) — design.google + 9to5google — "goal behind the goal", chart headers (text + visual), health literacy, Material You, compassion

### Design systems & compliance
- Apple Health HIG — developer.apple.com — in-context permissions, Activity rings rules, "Health app" terminology
- Android Health Connect UI guidelines — developer.android.com — Consistency/Transparency/Clarity
- WCAG 2.1 AA — contrast 4.5:1, 48px targets, no color-only status, 14pt font, 20s timeout warning — aap.org (2024 ADA/HHS rule), sanjaydey.com, screenroot.com
- HIPAA UX — saasfactor.co, sanjaydey.com — consent 6th-grade language, role-based access as separate flows, audit log visibility, contextual authentication
- GDPR — granular consent, right to erasure, data deletion UX
- Empty states (healthcare) — koruux.com — icon + clinical message + why + next action; success empty states
- Health dashboard uncertainty — dev.to (babycat) — separate SourceState from MeaningState
- Trust patterns — designx.co — plain language errors, privacy dashboard, biometric feedback
- Medical ID — Apple Support, RespondrID (App Store), MedicalID/EmergencyID (Play Store) — lock screen access, share during emergency call, family profiles, offline, NFC/QR

### Malaysia / SEA healthcare
- BookDoc — bookdoc.com + Play Store — Petaling Jaya, search & book, teleconsult categories, Waze/Grab integration, multi-lingual, activ wellness
- DoctorOnCall — doctoroncall.com.my — RM39.99 teleconsult, video/voice, prescription + medicine delivery, payment via Online Banking + Credit Card + e-Wallets (Boost, GrabPay), 50 specialities, promo codes
- Payment methods confirmed: FPX (Maybank2u, CIMB), Boost, GrabPay, Touch'n Go, ShopeePay, credit card

---

*End of specification. Next step: build the design system components in `core/widgets/`, then redesign Flow A (auth) as the first concrete screen work.*
