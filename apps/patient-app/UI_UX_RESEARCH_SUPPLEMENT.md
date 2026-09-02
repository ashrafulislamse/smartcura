# SmartCura Patient App — UI/UX Research Supplement (Round 2)

**Date:** 2026-07-26
**Status:** Supplements `UI_UX_SPEC.md` (Round 1). Does not replace it. Where this document and the spec disagree, this document wins — it is newer and more heavily sourced.
**Scope added:** patient-UX evidence beyond the spec, a complete **illustration system**, a complete **motion & micro-interaction system** (Flutter-ready tokens), **scenario playbooks** for every flow, a **microcopy library**, updated **Malaysia market data**, and a full source index.

---

## How to use this document

| If you are… | Read |
|---|---|
| Designing any screen | Part 4 scenario playbook for that flow + Part 5 microcopy |
| Building `core/widgets/` | Part 3 (motion tokens, skeleton spec) + Part 2 (illustration slots) |
| Building vitals charts (D3, D5) | §4.5 — the evidence changes the spec's chart design |
| Building Emergency SOS (F1–F3) | §4.6 — hold-down is evidence-backed; slider is not |
| Writing any user-facing text | Part 5 before Part 1 of the spec |
| Judging "is this premium enough?" | §8.1 award-criteria checklist |

---

# PART 1 — PATIENT UX EVIDENCE (new, beyond the spec)

## 1.1 The dual-audience problem (Momentum, saasfactor 2026)

Patient and provider interfaces must be **separate information architectures over the same data model** — never "the clinical screen with fields hidden." A patient viewing a lab result needs: plain-language interpretation + single recommended action + path to ask a question. Not reference ranges. The common failure is a *permissions-model* UI where the patient view is a stripped-down clinical tool. **SmartCura implication:** the patient app must never look like a clinician dashboard with things removed; every clinical datum gets a patient-facing *interpretation layer*.

## 1.2 Three properties of adherence-driving patient screens (Momentum)

Every screen that asks a patient to do something repeatedly (log vitals, take meds, attend consults) must have:
1. **Single decision per screen** — one action, not a menu of actions
2. **Contextual timing** — shown when the patient can act ("next dose 2:00 PM" beats "3x daily")
3. **Visible progress** — streaks, "3 of 4 taken", care-plan checkmarks — consistency must *feel achievable*

Also: **alert fatigue is structural, not visual.** Stratify alerts by urgency *structurally* (critical = inline + requires acknowledgment; non-critical = notification lane). Same visual weight for all alerts → systematic override (49–96% override rates documented in clinical CDS).

## 1.3 TheFinch — additions to the engagement ladder

Beyond Join→Book→Attend→Follow→Track→Return:
- **Waiting room must answer 4 questions in 10 seconds:** Is it confirmed? When will the clinician join? What do I do if it doesn't start? What do I prepare now?
- **"Consult structure strip"** inside the call: Symptoms → History → Assessment → Plan → Next step (tiny feature, big clinical clarity)
- **The 3-layer RPM screen** (use for every vitals card):
  - Layer 1 **Meaning** (not numbers): "Within your normal range" / "Slightly above baseline"
  - Layer 2 **Trend** (small, readable): last 7 readings, direction arrow
  - Layer 3 **Action** (one step only): "Retake in 15 mins" / "Share with clinician" / "Book check-in"
- **Reminder UX:** patient-controlled frequency, quiet hours, snooze, "why it matters" framing — never guilt.

## 1.4 Telehealth-specific (Whereby PM interviews, 2025)

- 88% of users abandon apps after a bad experience.
- Video layouts built for *business meetings* kill the patient connection — spotlight the doctor; consider hiding self-view to reduce patient self-consciousness.
- **Post-consultation continuity is the retention moment.** Automatic summary, integrated follow-up scheduling, immediate EHR-visible notes. "Most platforms excel at the call and fail at the before and after — where patient frustration concentrates" (sanjaydey).
- Privacy must be *visible*: recording notifications, participant lists, consent-driven data handling in-UI.

## 1.5 Contextual consent & contextual authentication (sanjaydey 2026)

- Break consent into **specific, contextual moments**: when connecting a wearable → one plain-language explanation of what data goes where; when sharing a care plan → confirm with a clear summary. Not one giant consent wall at signup (this *upgrades* spec A7: keep the layered A7 screen, but also re-ask contextually at the IoT pairing moment D4 and the share-with-doctor moment D7).
- **Contextual auth:** standard login for low-sensitivity actions; step-up (biometric/OTP) only for high-sensitivity (viewing results, authorizing refills). Session memory on trusted devices with a transparent "remember this device" explanation.
- **Offline data entry with sync-on-reconnect** is not an edge case — it is daily reality in Malaysian rural/low-connectivity contexts. No data loss when connection drops mid-form. (Directly relevant to D2 Enter Vitals and F flows.)

## 1.6 Anxiety-informed design (uxmate 2026 — the strongest single source on patient emotion)

- **Red is physiologically alerting — it raises heart rate.** Reserve true red *only* for genuine emergencies. Use amber/orange for "important but not critical." Pair even red with calm microcopy. (Audit: spec's clinical-status red `#EF4444` is correct for *critical* only; never use red for form errors — errors are amber-level events, red implies clinical danger.)
- **Raw out-of-range numbers in bold red at 11pm with the doctor's office closed = a design decision that causes panic spirals.** Always scaffold: plain-language summary first, clinical detail on tap (progressive disclosure).
- **Confirmation messages should pre-empt the next anxiety.** Not "Appointment confirmed" → "You're all set. Dr. Tan will see you Thursday at 2pm. We'll remind you the day before."
- **Progress indicators turn an unknown ordeal into a finite task** ("Step 3 of 6" measurably reduces abandonment).
- **Auto-save with "continue where you left off"** — a patient who stops a symptom form because the baby is crying and loses progress loses trust instantly. Applies to A4, A8, E1, and every form >1 field.
- **Loading states are emotionally loaded in healthcare.** "Securely connecting to your provider…" beats a spinner — it fills the wait *and* reinforces security.

## 1.7 Older-adult usability — the academic base (15 papers indexed in §7.2)

Consensus findings across systematic reviews (PMC8510293, PMC12350549, PMC10557006, PMC9717549, PMC8800094; MOLD-US framework pmid:27380441):
- The barrier is **usability, not access** (arxiv:2601.17012 — the "digital divide" in geriatric care is a *usability divide*).
- Design levers with the strongest evidence: larger text (16pt+ for critical instructions), high contrast, **one action per screen**, minimal memory load between screens, consistency of layout and navigation, error tolerance (easy undo, no punitive errors), no time pressure, larger touch targets, simple icon+text labels (icons alone fail).
- Persuasive features (reminders, goal-setting, feedback) improve adoption *only when* base usability is intact — decoration on a broken UI backfires.
- Lab-result interpretation studies (pmid:34042813) confirm patient portals that show clinicians' raw reports are "near impossible to interpret" without training — the interpretation layer is mandatory, not nice-to-have.

---

# PART 2 — ILLUSTRATION SYSTEM (new)

The spec had no illustration language. This section defines one, sourced from 6 healthcare illustration case studies.

## 2.1 Style decision: flat line-art with warm color fills and subtle elevation

| Candidate style | Verdict | Evidence |
|---|---|---|
| Grainy / textured | ❌ Reject | Milu Health explored it; rejected because it **doesn't produce efficient Lottie animations** — and our empty/loading states must animate |
| Photorealistic people photography | ❌ Reject | One Medical (Black Math Studio) research: stock photos of *specific* people stigmatize and exclude ("users do or don't see themselves"); some groups avoid seeking care because they can't see themselves receiving it |
| 3D objects/environments | ⚠️ Reserve for hero moments only | One Medical's answer for sensitive services — objects/materials communicate the service without gender/race/body/age coding. Too heavy for app-wide use |
| **Flat + minimal line-art + vibrant brand color, slightly exaggerated friendly expressions** | ✅ **Adopt as the system style** | El Meu Clínic (Hospital Clínic de Barcelona): this exact style onboarded **54,000 users** (1,500/month) with non-tech-savvy, older audiences; feedback specifically credited illustration *clarity* for UX improvement |

**System rules:**
1. **People when the moment is human** (onboarding, consultation, family profiles) — drawn in Malaysian diversity (Malay, Chinese, Indian, elderly, hijab-wearing, male *and* female doctors), warm and slightly exaggerated expressions for instant readability at small sizes.
2. **Objects/materials for sensitive services** (One Medical principle): STI/sexual-health, mental-health, and women's-health illustrations use stethoscopes, medicine bottles, plants, teacups, phones — never a person whose identity could feel exposing.
3. **Abstract shapes + gradients for microscopic/invisible concepts** (Samsung Health/illo): blood cells, viruses, heart rhythm, SpO₂ — main element carries the concept, supporting element carries the metaphor ("two levels of interpretation").
4. **Inclusivity default:** where identity is irrelevant, use stylized silhouettes or semi-transparent gradient figures (illo/Samsung rule).
5. **No bright red inside illustrations outside the Emergency flow.** Enests case study: red in healthcare illustration triggers subconscious alarm (danger/blood/failure). Emergency-flow illustrations may use the SOS red deliberately.
6. **Dynamic-but-calm composition:** slightly off-balance/floating layouts give static illustrations a sense of energy without motion (illo). When animated, motion is *subtle* — "non-overwhelming in an informational UI context."
7. **Character consistency:** build a small recurring cast (patient, doctor, pharmacist, courier, elderly parent, child) with character cards (Percipio pattern — 1,500+ assets stay coherent this way). Same faces across onboarding, consultation, pharmacy = the app feels like one world.
8. **High-contrast, saturated color for aging eyes** (Percipio: bright contrasting colors "essential for accessibility with aging eyes"), flat fills + defined line-work at 2px.

## 2.2 Illustration inventory (what to commission/build, per screen)

| Slot | Screen(s) | Content | Format |
|---|---|---|---|
| Onboarding set (4) | A2 | (1) patient + doctor on video call (2) elderly man + BP cuff + watch (3) courier + medicine bag (4) calm night scene, SOS shield | Flat, animated (Lottie) — subtle loop: pulse line, chat bubble pop, scooter movement |
| Splash emblem | A1 | Heart + pulse-line mark | Vector + one-time draw-in animation |
| Empty states (8–10) | B1, B2, D1, D3, G1, H1, I1, J9 | Object-forward scenes (clipboard, calendar, pill box, chat bubble, stethoscope) with gentle ambient loop — a breathing aura or floating, never frantic | Lottie loop ≤3s |
| Permission rationale (5) | A9 | Bell, camera, mic, map pin, Bluetooth wave — icon-scale illustrations on soft tinted circles | Flat static + micro-pulse |
| Success moments | C8, D2 save, G4 delivered | Checkmark bloom with soft radial — **calm closure, not confetti** (CarerCare: "warm, slow, soft… not flashy") | Lottie one-shot ~800ms |
| AI analyzing | E2 | Abstract pulse/neural dots forming, teal-on-surface | Lottie loop + reassurance copy |
| Emergency (F flow only) | F1–F3 | Shield + siren light — **only place red is allowed** | Static + countdown ring (motion, not illustration) |
| Sensitive-service set | G2 (sexual health, mental health categories), I chat | Object-based (One Medical principle) | Flat static |

---

# PART 3 — MOTION & MICRO-INTERACTION SYSTEM (new, Flutter-ready)

## 3.1 The three principles (Better.care — the only healthcare-specific motion framework found)

1. **Responsiveness** — every user action gets visible feedback (tap, hold, swipe). No 200ms dead zones (dead zones cause double-taps → duplicate bookings/payments).
2. **Orientation** — motion explains where things came from and where they went (sheet slides up from its trigger; detail screens push from their card).
3. **Contextual awareness** — motion intensity matches clinical context. Calm in vitals/consultation; slightly more energetic in onboarding/pharmacy; **minimal and non-startling in Emergency** (panic users need stability, not spectacle).

Healthcare rule of thumb (Better.care): *"Keep animation light, subtle and unobtrusive, yet clear and with a logical purpose. Every movement has to serve a purpose."*

## 3.2 Duration & easing tokens (paste into `design_tokens.dart`)

| Token | Duration | Curve (Flutter) | Use |
|---|---|---|---|
| `t1` | 100ms | `Curves.easeOut` | Press feedback, tap highlight, checkbox tick |
| `t2` | 150ms | `Curves.easeInOut` | Color/border transitions, focus rings, toggle |
| `t3` | 200ms | `Curves.easeInOut` | Crossfade skeleton→content, tooltip |
| `t4` | 250ms | `Curves.easeOutCubic` | Chip select, small element move, page route forward |
| `t5` | 300ms | `Curves.fastOutSlowIn` | Card expand, list item enter |
| `t6` | 400ms | `Curves.fastOutSlowIn` | Bottom sheet slide, modal |
| `t7` | 600ms | `Curves.easeOutQuart` | Large element entrance, hero illustration settle |
| `ambient` | 1.5–3s loop | `easeInOut` | Breathing auras, live-pulse dot, splash loading line |
| `shimmer` | 1.5s loop | `linear` | Skeleton sweep (translate -100%→100%) |
| `success` | 800ms | `Curves.easeOutBack` (subtle) | Checkmark bloom |
| `sosCountdown` | 5s | `linear` | SOS ring drain |
| `stagger` | 50–100ms/item | — | List/card entrance delay |

Rules: micro-feedback ≤300ms (Material + NN/g threshold for "instant"); bigger element = longer duration; **never autoplay dozens of loops on one screen; pause offscreen loops; honor `prefers-reduced-motion`** (WCAG 2.3.3 — static skeleton + instant swap fallback).

## 3.3 The SmartCura animation inventory (38 moments)

Format: trigger → motion → tone. Complexity rated for build planning.

**Auth (Flow A)**
1. Splash logo — pulse-line draws across heart once, then ambient breathing (`ambient`). *Easy.*
2. Onboarding — illustration elements settle with `t7` + 80ms stagger on slide change; active dot stretches (`t4`). *Easy.*
3. Login biometric — icon scans → soft check + "Face ID successful" (`t5`); fail = gentle shake (4px, 300ms) + plain copy. *Easy.*
4. Password strength — segments fill with `t4`, label color transitions `t2`. *Easy.*
5. OTP — filled box pops (`t1` scale 1→1.06→1) and focus auto-advances; wrong code = all boxes shake once + red-free amber message. *Easy–Med.*
6. Consent toggle — switch slides with weight (`t2`) — "weight, not snap" (rocket.new). *Easy.*

**Home/Dashboard (Flow B)**
7. Appointment card — slides up `t5` with 60ms stagger behind it. *Easy.*
8. Vitals snapshot sparklines — draw-on left→right `t7` when scrolled into view. *Med.*
9. Notification badge — count-up + soft pop. *Easy.*

**Consultation (Flow C)**
10. Search bar — placeholder text cycles ("Search by symptom… / specialty… / doctor name…") with crossfade `t3` every 2.5s. *Easy.*
11. Doctor card verified badge — one-time subtle shimmer on first appearance only (never repeating — trust signals shouldn't beg for attention). *Easy.*
12. Calendar slot select — slot fills `t2`, unselected siblings dim `t2`. *Easy.*
13. Booking confirm → payment — cards morph/shared-axis (`t6`). *Med.*
14. Payment processing — button label → spinner in place (button keeps size); lock icon pulses `ambient`. *Easy.*
15. Payment success — checkmark bloom `success` + soft radial glow; amount counts up. *Easy.* (No confetti — calm closure.)
16. Payment failed — no shake, no red flash; icon fades to neutral, copy explains, Retry pulses once after 1s. *Easy.*
17. Pre-call lobby — countdown ticks `t1`; mic-test waveform reacts live to voice; doctor-ETA line updates with soft text swap `t3`. *Med.*
18. Video call PiP — self-view docks with spring `t5`; controls auto-hide after 4s idle, reappear on tap `t3`. *Med.*
19. End-call confirm — "Are you sure?" sheet slides `t6`. *Easy.*
20. Post-call care plan — checkboxes tick `t1`, completed items strike-through `t2`, progress ring advances `t5`. *Easy.*
21. Star rating — stars fill with 60ms cascade `t2`. *Easy.*

**Health/IoT (Flow D)**
22. Live reading "live" dot — 1s pulse loop (`ambient`), pauses when reading goes stale (state change is communicated by the dot *stopping* + label change — motion itself carries meaning). *Easy.*
23. Live value update — number crossfades `t3` + tabular figures to prevent width jitter (CodeFronts: shifting widths "read as glitches"). *Easy.*
24. Sync banner — indeterminate sweep while syncing → check + "All synced" `t3`. *Easy.*
25. Chart trend line — draws `t7`; normal-range band fades in behind it `t5`; tappable points scale on touch `t1`. *Med.*
26. Threshold slider — value bubble pops above thumb `t2`; zone under thumb tints to its status color `t2`. *Easy.*
27. Device reconnect — radial "radar" sweep `ambient` during discovery; pairing success = check bloom `success`. *Med.*

**AI (Flow E)**
28. Analyzing — teal pulse dots form/dissolve `ambient` + rotating reassurance line; explicit "This is not a diagnosis" static below (never animated — legal text must be stable). *Med.*
29. Diagnosis card — confidence meter fills `t5`. *Easy.*

**Emergency (Flow F)**
30. SOS hold — ring drains over 5s `sosCountdown`; haptic on start and at 0; cancel = ring refills `t6`, everything settles (calm, no jarring stop). *Med.*
31. SOS active — timeline steps check in sequentially `t4` + 200ms stagger; "Help is on the way" breathes `ambient`. *Easy.*
32. Ambulance pin — pulses every 2s; route line draws once `t7`; ETA number updates with `t3` crossfade. *Med.*

**Pharmacy (Flow G)**
33. Add to cart — item thumbnail flies to cart icon `t5` (classic but functional), badge pops `t1`. *Med.*
34. Order timeline — current step pulses `ambient`; completed steps checked static. *Easy.*
35. Courier map — same pattern as #32. *Shared component.*

**Profile (Flow J)**
36. Data download requested — envelope/box icon settles `t5` + "We'll notify you within 30 days." *Easy.*
37. Logout — no animation (deliberate stillness = seriousness) — session clears, login fades in `t3`. *Easy.*
38. Medical ID lock-screen toggle — shield icon locks `t2`. *Easy.*

## 3.4 Skeleton & loading spec (from justfigma 2026 + Better.care)

- **Default to skeleton for any layout-known load** (lists, cards, dashboards). Spinner only for buttons, modals, <300ms waits, unknown layouts. Progress bar only when percentage is real (uploads, firmware update).
- Skeleton **mirrors the final component exactly** — same height, radius, padding (prevents CLS/visual snap). Publish a skeleton variant per real widget.
- **Minimum display 300ms** (prevents gray flash on fast loads); crossfade to content 200ms.
- Shimmer: 1.5s linear infinite gradient sweep; **static skeleton under reduced-motion**.
- **Never show an empty state during fetch** — users read "no data" as final. Never leave skeleton visible after error.
- State flow for every data view: `skeleton → (success+data) populated | (success+zero) empty | (failure) error+retry`.
- Button loading: spinner replaces or precedes label, **button disabled, size unchanged** (prevents double-submit of bookings/payments).
- Staggered list reveal: 50–100ms/row; shell (app bar + nav) loads first, content skeletons second.
- Loading copy in healthcare does double duty: "Securely connecting to your provider…", "Syncing your readings…" — status + reassurance.

---

# PART 4 — SCENARIO PLAYBOOKS

## 4.1 Onboarding (A1–A9) — "the first minute feels safe and simple"

Scenario beats (TheFinch + QuickMedi + El Meu Clínic):
1. Value before asking: 4 slides max, Skip always visible, last slide = "Get Started".
2. Get to a meaningful action fast — after signup, first-run home pre-highlights *one* next step (book / pair device / add Medical ID), not four equal tiles fighting.
3. Sensitive fields get a one-line "why" at the point of asking (A4/A8).
4. Progressive disclosure for health profile (A8): ask essentials now; conditions/allergies can be completed later with a progress nudge — but **flag the emergency value**: "Used by emergency responders — see Medical ID."
5. Google/phone-number sign-in reduces onboarding friction measurably (QuickMedi finding) — consider for the Malaysian market alongside email.
6. Permissions (A9): rationale screen *before* the system prompt, one permission per screen, "Maybe later" always allowed (grant-rate evidence: Apple HIG + Android Health Connect).

## 4.2 Booking (C1–C8) — "fewer choices, stronger guidance"

1. Care intent first (new / follow-up / renewal / second opinion) — it filters everything downstream.
2. Smart slot nudges: "Soonest available" recommended-first; group morning/afternoon/evening.
3. Booking must complete in **≤3 taps from doctor profile** (saasfactor benchmark; MyChart standard: date → confirm → done).
4. **Pre-payment review screen (C6) is an anxiety intervention, not a formality**: summary + "what happens next: [1] Join 5 min early [2] Consult ~20 min [3] Digital prescription" (Productgrowth.in — "reduces pre-booking anxiety").
5. Payment: amount breakdown (fee + platform fee + total in RM), Malaysia methods (§6.1), lock + "We don't store card details."
6. Success: checkmark bloom + transaction ID + "Add to calendar" + next-step preview. Failure: "Payment didn't go through. **No money was taken.** Try again or use a different method." — the bolded clause is the trust-critical sentence.

## 4.3 Waiting room (C10) — answers 4 questions in 10 seconds

Countdown ("starts in 4:32") · doctor status line ("finishing a previous consult — est. 2–5 min") · device check (camera preview, mic waveform reacting to voice, connection strength) · fallbacks ("Switch to audio" / "Chat support") · reassurance ("We'll notify you the moment Dr. Tan joins"). Pre-fill symptoms summary + auto-pulled recent vitals so the patient *does something useful* while waiting (active waiting room, Productgrowth.in).

## 4.4 The consultation itself (C11–C12) — "video is not the product; the care flow is"

- Spotlight the doctor; self-view PiP optional/hideable (self-consciousness is real — Whereby).
- Top strip: timer, connection, **encryption icon** (visible privacy = trust).
- "View my vitals" side sheet pulls readings into the call without breaking it (Blum case study: real-time vitals + EMR access during call was *the* redesign goal).
- Consult structure strip: Symptoms → History → Assessment → Plan → Next step.
- End-call requires confirm ("Are you sure?") — accidental hang-ups in a medical call are a safety event.
- **The next 48 hours decide retention** (TheFinch): post-call summary = care plan checkboxes + "what to track this week" + "if you feel worse" escalation + prescription ready + one-tap follow-up + rate. Microcopy: "Your summary is saved. You can return anytime."

## 4.5 Vitals & trends (D1, D3, D5) — **this section changes the spec's chart design**

Two peer-reviewed studies (BMC Med Inform Decis Mak 2021; JMIR 2019 — see §7.2) established how patients *misread* BP data and what fixes it:

**Problems proven in patient studies:**
- Patients overweight outliers — even 1–2 extreme values make them judge their hypertension as uncontrolled (JMIR Study 3, p<.001).
- Patients overweight recency and miscount out-of-range values (recall "largely inaccurate").
- Increasing trends alarm appropriately; variability alarms inappropriately.

**The evidence-based display (adopt for D3):**
1. **LOWESS-smoothed trend line** over raw points — emphasizes the mean trend that predicts outcomes; deemphasizes clinically-low-significance fluctuations. Raw points stay tappable, small and de-emphasized.
2. **Goal-range bands as colored background zones** (not dotted lines — bands tested dramatically better for at-a-glance control judgment).
3. **Like-with-like paradigm:** the line's color *matches its own band's color* — "if the line is inside the band of matching color, you're in range." Colorblind-safe pair from the study: **mint `#008471` (systolic) + cocoa `#9C652B` (diastolic)** — adopt for BP dual-line; keep spec's status palette for point flags.
4. **Text insight header above every chart** ("Your resting HR averaged 72 bpm this week — within your normal range") — Fitbit + these studies agree text carries the interpretation; the chart supports it.
5. Optional medication-timeline lane below BP chart (links med changes → BP response).
6. Per-vital bands: BP dual-band; HR resting/exercise zones; SpO₂ 95–100% band; Temp 36.1–37.2°C; glucose fasting/post-meal.
7. Sparklines (D1 cards): 6–12 points, normalized to the *clinical range* of that metric (not a shared scale — shared scales flatten every line), current value + status flag as text always present — **the sparkline is decoration over data that must exist as text** (CodeFronts medical-dashboard pattern; flags pair glyph ▲▼ AND word, never color-only).

## 4.6 Emergency SOS (F1–F3) — hold-down is the evidence-backed interaction

- **Hold-down beats slider**, proven in emergency-UX testing (Safira Humaira case study): prevents accidental activation, cancel = simply release (intuitive under panic), requires less precise finger control than sliding when hands are shaking, needs no explanation. Adopt for F1 (already in spec — now evidence-backed).
- Android Emergency SOS reference pattern: hold inside red circle ~3–5s, or 5-second countdown with alarm + cancel; configurable 0–10s; full-screen countdown overlay; haptics at start and trigger (alexff91/emergencybutton — an open-source **Flutter** implementation with countdown overlay, Material 3, semantic labels — directly referenceable).
- Design must reconcile a conflict (Itexus case study): *urgent and life-critical* yet *soothing and confidence-instilling* — solve with calm red, steady countdown, and the sentence "Help is on the way" from the first second of F2.
- F2 timeline: ✓ SOS sent → ✓ [Contact] notified → ⏳ Ambulance dispatched → ⏳ En route → ⏳ Arrived. Cancel requires a reason ("I'm safe / false alarm / resolved") — captures data + prevents careless dismissals.
- F3 map: patient pin + moving ambulance pin + **real driving-time ETA** (not a window, not a dispatch-time guess — PharmGo: ETA must move with the driver) + "arriving in ~8 min" banner + driver name + call button. Consider privacy-grading courier/ambulance position precision.
- Post-SOS: haptic + sound + "Calling 999 + notifying [Aisyah (spouse)]" — name the contact, don't say "your emergency contact."

## 4.7 Pharmacy & delivery (G1–G5) — benchmarks: Phlo, PharmGo, DoctorOnCall

- **DoctorOnCall's actual prescription flow** (verified on their site, §6.1): select medication → enter patient details at checkout → doctor calls within 60 min from a *named number* → doctor assesses & prescribes (may substitute) → pharmacist reviews → packed → delivered. SmartCura's G flow should mirror this transparency: every handoff is a visible status.
- **Status timeline** (DigitalPharmacy standard): pending → approved/verified → packed → picked up → out for delivery → delivered, with a push at every transition.
- **Live courier map + real ETA + "nearly there" ping ~10 min before arrival** (PharmGo Track+ — "patients are at the door when the driver is").
- **Upload UX:** camera or file (PDF/JPG/PNG), multiple Rx at once, Rx linked to the cart items it covers; pharmacist chat for clarification.
- **Delivery options:** express vs scheduled time slots at checkout (chronic-care patients want predictability).
- **Anti-pattern to avoid (PharmEasy 1-star reviews):** showing "delivery tomorrow" repeatedly while silently out of stock destroys trust. If an item can't ship, say so immediately with a substitute/refund option.
- Refill: one-tap reorder from history + reminder before the dose run-out date (Phlo's reorder reminder pattern).

## 4.8 Errors, empty states & "unhappy paths"

**NHS App error-page guidance (Jan 2026 — the most rigorous error research published for health apps):**
- Heading pattern: **"There is a problem"** + a few words naming the service — users read the heading, skip the body, and hit the button, so the heading must carry the message.
- **Button immediately after the body** (not at page bottom — bottom placement separated action from explanation).
- **No back button on error pages** — back can fail in error state, creating navigation loops; give forward links instead.
- Distinguish **unexpected errors** (this pattern) from **expected unhappy paths** ("cannot continue" — old app version, maintenance) which need bespoke, non-alarming content.
- Include a "For urgent medical help" section on any error in a clinical area — an error must never be a dead end for someone who is ill (SmartCura: every error screen in clinical flows shows "If this is an emergency, call 999").
- Research finding: users tap "Try again" multiple times before reading — so retry must be *safe and idempotent*.

**Koruux clinical empty states:** message = clinical term ("No active appointments", not "No data") + why it's empty + what normally appears here + next action. Four types: initial-setup ("what will appear as you receive care"), processing ("results being verified — check back after 2pm" + link to previous results), true-empty with action, and **success-empty** ("You're all clear — no overdue actions") which *celebrates* the emptiness.

**Microcopy for failures** (DesignX + uxmate): explain what happened without blame → exact next step → warm tone. "We didn't recognize that date format — try DD/MM/YYYY" not "Invalid date of birth."

---

# PART 5 — MICROCOPY LIBRARY

## 5.1 Ten techniques (Komolafe — healthcare UX writing)

1. **Reason-why framing** — explain the ask before the ask ("We ask for your blood group so emergency responders can act faster").
2. **Validate before you nudge** — meet the user where they are ("Tracking vitals every day is hard. Even 3 days a week helps.").
3. **Soft retry language** — comfort, never scold ("That didn't go through — let's try again").
4. **Therapist-style onboarding** — calm, one step at a time.
5. **Jargon translation** — if a user needs Google to understand the app, the app has already lost them.
6. **Collaborative error handling** — "Let's…" frames app+user as a team.
7. **Tone layering for sensitive moments** — empathy + choice + neutrality for trauma/loss/illness content.
8. **Normalize setbacks** — missed a dose? "Tomorrow's a new day."
9. **Agency-centered copy** — center the user's control: opt in, pause, review, anytime.
10. **Emotional range over robotic consistency** — adjust tone to the moment; not every message sounds the same.

Litmus test for every string: *Does this sound like care? Would it feel good to read on a hard day? Does it earn trust?*

## 5.2 SmartCura rewrites (use these verbatim in screens)

| Context | ❌ Generic | ✅ SmartCura |
|---|---|---|
| Login fail | "Invalid credentials" | "That email doesn't match an account. Try again, or sign up if you're new." |
| Session end | "Session timed out" | "For your security, we signed you out. Sign in again to continue — nothing was lost." |
| No vitals | "No data available" | "No heart rate readings yet. Pair a device or log one manually — it takes 30 seconds." |
| Sync fail | "Error 500" | "We couldn't reach your readings. Your device keeps them safe — we'll retry automatically." |
| BP high | (red number only) | "Your blood pressure is higher than your usual range. Sit quietly for 5 minutes and retake it. If it stays high, we'll help you reach your doctor." |
| Booking done | "Appointment confirmed" | "You're all set. Dr. Tan will see you Thursday at 2:00 PM. We'll remind you the day before — and you can join 5 minutes early." |
| Payment fail | "Transaction failed" | "Your payment didn't go through, and no money was taken. Try again, or choose another method." |
| OTP wrong | "Invalid OTP" | "That code isn't quite right — check the latest SMS and try again." |
| Empty notifications | "No notifications" | "You're all caught up. Appointment reminders and health alerts will appear here." |
| AI disclaimer | "AI may be inaccurate" | "This is guidance, not a diagnosis. Only a doctor can diagnose you — and we can book you one in about a minute." |
| Delete account | "Are you sure?" | "Deleting removes your account permanently after 30 days. You can change your mind anytime in that window. Your medical data can be downloaded first." |

---

# PART 6 — MALAYSIA / SEA MARKET DATA (updated & verified 2026-07-26)

## 6.1 DoctorOnCall — the direct Malaysian competitor (verified from doctoroncall.com.my + help centre + Play Store)

- **Pricing:** GP teleconsult **RM39.99** per consult (online-doctor page); chat/video/audio GP "from RM15"; **specialist consults from RM80 across 50 specialties**.
- **Flow:** Consult Now → secure online payment → connected to GP. For prescriptions: select medication + enter patient details at checkout → **doctor calls back within 60 minutes** from named numbers (+6016 299 1377 / +603 2705 3828) → assesses, prescribes (may substitute) → pharmacist reviews & prepares → packed → doorstep delivery.
- **Payments (verified FAQ):** Online Banking, Credit Card, e-Wallets (**Boost, GrabPay**). Spec's FPX (Maybank2u/CIMB) + Touch'n Go + ShopeePay list remains correct as the superset for SmartCura.
- **Trust signals:** "Multilingual **MOH-certified** doctors (BM, English, Mandarin)" — SmartCura should mirror: **MMC-registered + MOH-certified** badges with registration numbers.
- **Growth hook:** RM30 cash reward on signup; rewards account on every purchase.
- **Positioning:** "Malaysia's first and largest digital healthcare platform" — 3 services: Teleconsultation, Online Pharmacy, Book a Specialist. Chronic-care refills and corporate accounts are explicit pillars.

## 6.2 BookDoc (Petaling Jaya, est. 2015)

- Operates MY/SG/HK/TH/ID; ~$2.3M annual revenue; search & book, e-MC (medical certificates), teleconsults, wellness/activ (Grab/Waze-style integration heritage), mental health, HRDC-claimable corporate wellness. Implication: SmartCura's differentiators are **IoT vitals + AI triage + emergency SOS** — BookDoc has none of these.

## 6.3 Halodoc (Indonesia — the regional UX benchmark)

- 24/7 GP + specialists; medicine **delivery within 1 hour**; homecare expansion (home lab tests with 24h in-app results, vaccinations, vitamin IV, doctor house calls with same-day booking); "Sambungkan Asuransi" insurance-link feature. Trust copy: "Ribuan dokter berlisensi, apotek terdaftar" (thousands of licensed doctors, registered pharmacies). Implication for SmartCura G flow: speed expectation is *hours*, not days — surface realistic ETAs honestly.

## 6.4 Confirmed Malaysian payment stack for SmartCura

FPX online banking (Maybank2u, CIMB Clicks, RHB, Public Bank) · e-wallets (Touch'n Go eWallet, GrabPay, Boost, ShopeePay) · credit/debit (Visa/Mastercard). Emergency: **999**. Languages: **EN / BM / 中文 / தமிழ்**. Currency **RM**. Phone **+60**.

---

# PART 7 — SOURCE INDEX (Round 2, all accessed 2026-07-26)

## 7.1 Industry & case studies
| # | Source | URL | Key contribution |
|---|---|---|---|
| 1 | Momentum — Healthcare UX Principles | themomentum.ai/blog/healthcare-ux-design-principles-patient-provider-apps | Dual audience, 3 adherence properties, alert stratification |
| 2 | Whereby — Telehealth UI/UX (2025) | whereby.com/blog/optimise-telehealth-ui-ux-for-better-patient-experience/ | 8 telehealth optimization areas, video layout |
| 3 | Sanjay Dey — Patient-Centered UX 2026 | sanjaydey.com/patient-centered-ux-healthcare-apps/ | Contextual consent/auth, offline sync, telemedicine checklist |
| 4 | TheFinch — Telemedicine best practices (2026) | thefinch.design/designing-telemedicine-and-remote-care-apps… | Waiting room 4-questions, 3-layer RPM, consult strip |
| 5 | saasfactor — Healthcare Mobile Design 2026 | saasfactor.co/blogs/healthcare-mobile-app-design | ≤3-tap booking, thumb zone, 2025–26 trends |
| 6 | Galaxy UX — Blum telehealth redesign | galaxyux.studio/case-study/blum-telehealth-platform-redesign/ | Real-time vitals + EMR in-call |
| 7 | QuickMedi case study (Medium) | medium.com/@shipratrivedi1998/quickmedi… | Progressive disclosure, urgent-care priority, skippable feedback |
| 8 | SolGuruz — Telemedicine case study | solguruz.com/case-studies/healthcare-telemedicine-app/ | Consult+Rx+pharmacy unified journey, Flutter |
| 9 | Softaims — CareBridge Flutter health app | softaims.com/casestudy/flutter/flutter-health | Waiting-room states, consent capture, fallbacks (Flutter) |
| 10 | Itexus — Emergency ambulance app design | itexus.com/portfolio/design-for-emergency-mobile-app-for-ambulance-call/ | Urgent-yet-soothing conflict |
| 11 | Safira Humaira — Emergency UI/UX | fira00.medium.com/designing-ui-ux-for-emergency-case… | Hold-down > slider evidence |
| 12 | alexff91/emergencybutton (Flutter OSS) | github.com/alexff91/emergencybutton | Countdown overlay, haptics, M3 — Flutter reference |
| 13 | Teesha Madan — Android SOS System | teeshamadan.com/adroidsos | Accidental-trigger reduction, trust via clarity |
| 14 | Google — Android Emergency SOS | support.google.com/android/answer/9319337 | 5×power + hold/countdown pattern |
| 15 | Phlo Digital Pharmacy (Play Store) | play.google.com/store/apps/details?id=com.wearephlo.phlo | 120-min delivery, live map, reorder reminders |
| 16 | PharmGo — Track+ | pharmgo.co.uk/prescription-delivery-tracking | Real driving-time ETA, nearly-there ping, privacy grading |
| 17 | DigitalPharmacy.io — consumer app | digitalpharmacy.io/consumer-mobile-app/ | Rx upload UX, status states, express/scheduled |
| 18 | PharmEasy (Play Store, incl. negative reviews) | play.google.com/store/apps/details?id=com.phonegap.rxpal | Anti-pattern: silent out-of-stock destroys trust |
| 19 | Better.care — Animation in healthcare | better.care/blog-en/using-animation-and-motion… | 3 motion principles, tokens, checklist |
| 20 | rocket.new — Micro-interactions guide | rocket.new/blog/micro-interactions-for-ai-generated-apps | ≤300ms rule, trigger-response-timing prompting |
| 21 | Joche Ojeda — Lottie in products | jocheojeda.com/2026/06/08/lottie-small-animations… | State-driven animation, reduced-motion, performance |
| 22 | ashrocket — Lottie lessons (CarerCare) | gist.github.com/ashrocket/c60b9a65718fe7e79b420ec948b5b093 | Healthcare animation tone: "warm, slow, soft", 10-animation inventory |
| 23 | Enests — Healthcare illustration assets | enests.co/blog/bending-pre-made-assets… | No red in healthcare illustration; Lottie empty states |
| 24 | justfigma — Loading states 2026 | justfigma.com/designing-loading-states-and-skeleton-screens-in-figma/ | Skeleton spec, 300ms min, state matrix |
| 25 | CodeFronts — Patient vitals timeline | codefronts.com/layouts/css-timelines/vitals-timeline/ | Sparkline normalization, glyph+text flags |
| 26 | Milu Health — Irene Mateos | enerimateos.com/milu-health/ | Flat style chosen for Lottie efficiency |
| 27 | El Meu Clínic — Anna Massana | annamassana.com/portfolio/el-meu-clinic/ | Line-art style, 54k onboarded, elderly audience |
| 28 | One Medical 3D — Hannah Cusworth | hannahcusworth.com/one-medical-3d-illustrations | Object-based inclusive illustration research |
| 29 | Percipio Health — Brynn Gartner | brynngartner.com/healthcare-app-illustrations-1 | High-contrast for aging eyes, 1,500+ library |
| 30 | illo × Samsung Health | illo.tv/samsung-health-illustration-system | Two-level interpretation, silhouettes for inclusivity |
| 31 | Komolafe — 10 UX writing techniques | medium.com/@dolakomos/10-ux-writing-techniques… | Microcopy techniques |
| 32 | Koruux — Healthcare empty states | koruux.com/blog/empty-state-design/ | Clinical empty-state taxonomy |
| 33 | DesignX — 7 trust patterns | designx.co/healthcare-app-design-patient-trust/ | Biometric feedback, plain-language errors |
| 34 | uxmate — Patient anxiety & UX | uxmate-blog.com/…/how-to-design-digital-health-tools-that-reduce-patient-anxiety/ | Red avoidance, confirmation design, auto-save |
| 35 | NHS App — Error page guidance (Jan 2026) | design-history.nhsapp.service.nhs.uk/design-system/2026/01/error-guidance-update/ | "There is a problem" pattern, button placement, no-back rule |
| 36 | DoctorOnCall | doctoroncall.com.my (+ /online-doctor/, /help/) | MY pricing, 60-min callback flow, payments |
| 37 | BookDoc | bookdoc.com | MY competitor landscape |
| 38 | Halodoc (Play Store) | play.google.com/store/apps/details?id=com.linkdokter.halodoc.android | 1-hr delivery, homecare benchmark |

## 7.2 Academic (peer-reviewed)
| # | Paper | ID | Key finding |
|---|---|---|---|
| A1 | Home BP data visualization for shared decision making | BMC Med Inform Decis Mak 2021; doi:10.1186/s12911-021-01598-4 (PMC full text) | LOWESS smoothing, goal-range bands, like-with-like color paradigm, colorblind-safe mint/cocoa |
| A2 | Patient judgments about hypertension control (variability/trends/outliers) | JMIR 2019;21(3):e11366 (PMID 30907180) | Outliers & trends skew patient judgment — smoothing + text interpretation required |
| A3 | mHealth apps for older adults: interface & persuasive features (systematic review) | pmcid:PMC8510293 | Base usability before persuasion |
| A4 | Optimizing mobile app design for older adults (systematic review) | pmcid:PMC12350549 | Age-friendly design levers |
| A5 | Design guidelines of mobile apps for older adults (systematic review) | pmcid:PMC10557006 | Text size, consistency, error tolerance |
| A6 | Usability evaluation of mHealth apps for elderly (scoping review) | pmcid:PMC9717549 | Standard methods fail elderly cohorts |
| A7 | MOLD-US: aging barriers framework | pmid:27380441 | Sensory/physical/cognitive barrier taxonomy |
| A8 | Human-centered design of mHealth for older adults | pmcid:PMC8800094 | UCD process evidence |
| A9 | The digital divide in geriatric care: usability, not access | arxiv:2601.17012 | UX is the adoption barrier |
| A10 | Lab test interpretation app: UX + eHealth literacy inspection | pmid:34042813 | Raw lab displays unusable for citizens |
| A11 | Health literacy & usability heuristic evaluation | pmid:23920652 | Combined literacy+usability method |
| A12 | UI attributes & uncertainty avoidance on mHealth stickiness (young elderly) | pmcid:PMC12108990 | UI attributes drive retention |
| A13 | Senior-friendly mHealth requirements | pmcid:PMC9602267 | Requirement taxonomy |
| A14 | Considerate mHealth for ADRD (dementia) | pmid:34015657 | Extreme-case accessibility |
| A15 | mHealth usability framework for older patients | pmid:25991261 | FRAME framework |

---

# PART 8 — WHAT CHANGES FOR SMARTCURA (decisions log)

1. **D3/D5 charts adopt the BMC/JMIR evidence:** LOWESS-smoothed line + like-with-like colored goal bands (BP: mint `#008471` systolic / cocoa `#9C652B` diastolic) + mandatory text insight header. Spec's "dual-line with target zone shading" is upgraded, not discarded.
2. **F1 SOS: hold-down confirmed as correct** (spec was already right — now evidence-backed; slider explicitly rejected). Add: configurable countdown, full-screen overlay, haptic at start + trigger, "Help is on the way" from second zero, cancel-with-reason.
3. **New illustration system** (§2): flat line-art, recurring cast, objects for sensitive services, no red outside Emergency, Lottie-first for animatable slots.
4. **New motion system** (§3): 12 duration/easing tokens + 38-animation inventory + skeleton spec. Add `core/motion/` alongside `core/widgets/`.
5. **Red reserved for true clinical emergencies and critical vitals.** Form errors, failed payments, wrong OTP → amber/neutral treatments (§1.6). *This softens the spec's "error in #EF4444" guidance.*
6. **Error pages adopt the NHS 2026 pattern** (§4.8): "There is a problem" heading, button after body, no back button, "For urgent medical help: call 999" in clinical areas.
7. **C6 pre-payment confirmation kept and strengthened** — it is an anxiety intervention (Productgrowth.in).
8. **G flow mirrors DoctorOnCall's transparent handoff chain** + PharmGo's live ETA; honest out-of-stock handling is a trust requirement (PharmEasy counter-example).
9. **Consent becomes contextual, not only at signup** — re-ask at IoT pairing (D4) and data sharing (D7) with one-line explanations (sanjaydey).
10. **Every confirmation message pre-empts the next anxiety** (§5.2 rewrites are the standard).
11. **Pricing anchor:** DoctorOnCall GP RM39.99 / specialist RM80 — SmartCura's demo data should sit plausibly in this band (RM30–50 GP).
12. **Differentiation confirmed:** BookDoc (closest MY competitor) has no IoT vitals, no AI triage, no SOS/ambulance tracking. Those three are SmartCura's award-winning edges — their screens (D5, E1–E3, F1–F3) deserve the most design investment.

---

*End of Round 2 research. Next: regenerate/refine screens from Batch 2 onward against this supplement; when building Flutter, Parts 2–3 translate directly into `core/illustration/` + `core/motion/`.*

---

# PART 9 — FLOWSTEP RENDER HANDOFF (appended 2026-07-26, post-Batch-4)

> Purpose: cold-start continuity. A future session reading ONLY this file must be able to resume UI generation without re-doing research or re-deriving state. The Flowstep raster is for sign-off; the Flutter build (`core/widgets/`, `core/motion/`, `core/illustration/`) is the source of truth. Every "quirk" below is a **code-level** fix — do NOT spend Flowstep messages iterating on them.

## 9.0 Identifiers
- **Active Flowstep file:** `852abb93-e904-48d3-b99e-9b2b8b5ecf7a` — "SmartCura Patient App — Redesign v2". Design guidelines are **locked** on it (teal `#0F766E` primary, cyan `#06B6D4` accent, Poppins display + Inter body, radii 12/16/28px, 48px targets, clinical status = color+label+icon always, amber-not-red for non-clinical, illustration + motion rules, NHS error pattern, Malaysia context, anti-pattern list). Review: `https://app.flowstep.ai/file?activeFileId=852abb93-e904-48d3-b99e-9b2b8b5ecf7a`
- **Old file (IGNORE, untouched):** `4ed4cf17-2857-4cb9-8d77-25451e7b24c4`.
- **Locked decisions:** deliverable = hybrid (Flowstep sign-off now, Flutter later); batch order = sequential/original; states approach = default (render high-anxiety states for sign-off — wrong login/OTP, payment-failed, empty lists, SOS — happy-path + copy elsewhere; the 4-state rule is satisfied in code via the `EmptyState`/`LoadingState`/`ErrorState` library in spec §1.5).

## 9.1 Canonical KEEP manifest (21 screens signed off)
Format = Flowstep list-order # | logical label | screenId.
- 1 | A1 Splash | `f05195c1-a29d-432a-a5f1-43dd1c238928`
- 2 | A2 Onboarding | `146d845b-a713-4b23-972b-9bae0f891736`
- 3 | A3 Login | `72c5e63f-e011-41dd-84b3-a00957c419dd`
- 4 | A4 Signup | `38927078-57c3-4384-b802-f396a9a93f89`
- 5 | A5 OTP | `894b275a-e891-4e48-817f-9d1d40a297e8`
- 6 | A9 Permission-Bluetooth | `ac01cbbc-bafe-4333-838c-0d3cea173633`
- 7 | A10 Forgot Password | `0b57bbf1-82fa-4fd4-932a-1718d6af9070`
- 8 | A6 Email Verify | `be54dcf8-2daf-4875-8ba8-06ad50eccda4`
- 9 | A7 Consent | `c82c1bd1-60fb-43bf-9cc7-f335b0d67020`
- 10 | A8 Profile Setup | `f9bc0625-033f-416c-b4c9-f4c6fcf15831`
- 16 | B1 Home | `5c47a350-ed15-4398-a562-cfc52ee32622`
- 12 | B2 Notifications | `32fb82f8-7c6e-4353-a1fa-1036ae0f8c56`
- 17 | C1 Find Doctor | `efe08770-ae4b-4286-ad8f-4c313d083aa1`
- 14 | C2 Filters sheet | `b3c7d5a2-3742-455c-be5b-0ff79a45635b`
- 15 | C3 Doctor Profile | `b47963db-473f-4efe-b5d0-f992b87fb369`
- 24 | C4 Reviews | `3d40a358-5908-4a0d-aa9f-66fc638590d0`
- 25 | C5 Book Appointment | `7a26649f-0eb8-4d79-a97f-fa25e677063a`
- 22 | C6 Booking Confirm | `715b5a97-6b2a-4442-bb10-fb3caebbfd37`
- 23 | C7 Payment | `e67e6131-bc36-47e6-b431-3a88f71af539`
- 20 | C8a Payment Success | `0132d243-37a5-471a-8cc2-2c6652ec67dd`
- 21 | C8b Payment Failed | `493e2101-87a9-4888-ad89-dc422fafc06a`

## 9.2 DELETE manifest (6 duplicates — manual in Flowstep UI; MCP has no delete)
- 11 | `054ae675-ad29-415f-9d35-da81f1be5019` — old B1 (402x874)
- 18 | `2cfcd353-f133-4086-9980-c483b5bce34e` — dup B1 (verbatim-long prompt)
- 13 | `551aa1e3-4bf8-4b25-9a30-a517d90704de` — old C1 (402x874)
- 19 | `e7a561b2-2c8a-4292-a890-63633200efe6` — dup C1 (verbatim-long prompt)
- 26 | `309b90cc-8b2e-4f44-ab6f-9db64c4a3997` — dup C4 (verbatim-long prompt)
- 27 | `fb37a83b-fe34-443c-aa0d-20ba17c81c77` — dup C5 (verbatim-long prompt)

After deletion the file holds exactly 21 screens. **Orphan still to design: A11 Reset Password** (slot into a small catch-up batch).

## 9.3 Renderer quirk list (code fixes — do NOT iterate in Flowstep)
| # | Symptom | Code fix |
|---|---|---|
| 1 | Headings/titles incl. 16–20pt card titles (e.g. C7 "Payment", C1 doctor names) slip into a **serif** slot | force `fontFamily: 'Poppins'` on every heading/title style |
| 2 | **Selectable chips / segmented options / day-cards / slot-pills / aspect-chips / filter-chips** lose container + selected fill (render as plain text). *Renderer DOES correctly render:* removable ✕-chips, dropdown chips, the "Soonest" tag, verified badges, **segmented controls (C7), radio rows (C7/C5), rating distribution bars (C4), range-slider bubbles (C2), receipt right-align (C6), amber-glow circle + bold-inline emphasis (C8b)** | give every *selectable* chip/segment its own container + selected-fill style in the widget; never rely on the renderer for those |
| 3 | Missing space before an appended inline link ("minutes.Change") | add the space in the string |
| 4 | Blank/dropped text in pills or interpolated values (OTP button, A9 top pill, A10 card, C8a in-card "+" label, C8b dropped "41.00") | fix the string/template; `edit-design` text-addition works as a raster patch (proven 3x) if a stakeholder wants the PNG fixed |
| 5 | **Teal fill inconsistent across element types** — full-width buttons sometimes teal (C6/C7/C8b) sometimes near-black (B1/C8a); large filled circles + left accent bars also go black (C8a) | define ONE primary style = `#0F766E`, apply to every primary button/fill/accent in code |
| 6 | Onboarding pagination dots dropped (A2) | build the dot `Row` in code |

## 9.4 Process rule — timeouts & retries (the expensive lesson)
Multi-screen `create-new-design` calls **DO persist**, but **late and out of order**, so a `list-screens` taken too soon *looks* like a loss. Same-turn "retries" are what tripled B1/C1 and doubled C4/C5 (the §9.2 duplicates). **Rule: after a timeout, `list-screens` ONCE; if a label is absent, WAIT and list again before retrying — never fire a same-turn retry.** Single-screen calls store the prompt verbatim; multi-screen calls get rewritten by the backend — both keep full content. From Batch 5 onward prefer **single-screen calls** for predictability. Embed a mapping tag `label "XX Screen Name"` in every prompt; map by searching `list-screens` prompt text (numbering has gaps). `get-screen-image` IS viewable by the model — use it for real QA. `read_file` does NOT consume the monthly message cap; `get-plan-details` / every Flowstep tool call DOES — re-check budget before each batch and stop rather than die mid-batch.

## 9.5 Validation wins (renders confirmed these supplement decisions)
C8b used **amber not red** + the bolded trust clause "No money was taken from your account" (§1.6, §4.2.6) ✓. C6 carried the cyan "WHAT HAPPENS NEXT" 3-step anxiety block (§4.2.4, decision 7) ✓. C7 surfaced the full Malaysia stack — TnG/GrabPay/Boost/ShopeePay with muted brand badges + FPX Maybank2u·CIMB·RHB·Public Bank + Visa/MC, GP RM39 (decision 11, §6.4) ✓. B1 showed a **stale vital** state in grey not red (§1.6) ✓. C1/C3 carried prominent **MMC-verified** badges + a **Female doctor** tag (§4.1) ✓.

## 9.6 Remaining batches (sequential order locked) — ~25 screens + A11
- **B5 Consultation core:** C9 Appointment Details · C10 Pre-call Lobby · **C11 Video Consultation (HARDEST render — budget 2 attempts)** · C13 Post-call Summary · C14 Rate & Review. Re-read spec L375–413 + supplement §4.3/§4.4 before generating.
- **B6 Health/IoT:** D1 Health hub · D2 Enter Vitals · D3 Vitals History/Trends · D5 Live Readings · D6 Alert Thresholds. Re-read spec L413–452 + §4.5 (LOWESS charts).
- **B7 AI + Emergency:** E1 Symptom Input · E2 AI Analyzing (+E3–E5 diagnosis exist in repo — verify) · F1 SOS (hold-down, §4.6) · F2 SOS Active · F3 Ambulance Tracking. Re-read L452–498 + §4.6.
- **B8 Pharmacy + Rx (7 — split across 2 calls):** G1 · G2 · G3 · G4 · H2 · H3 · H4. Re-read L498–539 + §4.7.
- **B9 Messages + Profile (8 — split):** I1 · I2 · J3 · J4 · J7 · J9 · J11 · J12. Re-read L539–599.
- **Catch-up:** A11 Reset Password.

## 9.7 Budget note
As of 2026-07-26 the monthly message cap was near exhaustion after Batch 4 (21/46 done). Generation resumes at the next monthly reset; call `get-plan-details` first to confirm headroom. Quality bar unchanged: premium/professional/healthcare-grade, WCAG 2.1 AA, Poppins+Inter, no AI defaults (no centered hero trios, indigo/violet/pink, gradient headlines, glassmorphism, aurora blobs, cream/terracotta, near-black+neon). Malaysia context (RM, +60, 999, EN/BM/中文/தமிழ், female-doctor preference) on every relevant screen.
