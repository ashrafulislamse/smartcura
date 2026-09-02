import Link from "next/link";
import { FigureImage } from "@/components/public/figure-image";
import { PulseDivider } from "@/components/public/pulse-divider";

interface Surface {
  id: "patient" | "doctor" | "driver" | "portal";
  label: string;
  role: string;
  roleColor: string;
  blurb: string;
  features: ReadonlyArray<string>;
  screenshots: ReadonlyArray<{ src: string; alt: string; caption: string }>;
  limitations?: ReadonlyArray<string>;
}

const SURFACES: ReadonlyArray<Surface> = [
  {
    id: "patient",
    label: "Patient app",
    role: "Flutter · Android · iOS",
    roleColor: "var(--color-role-patient)",
    blurb:
      "For people whose sensors write to the pipeline. Health Connect sync, BLE pairing, live vitals, AI chat, video consultations and SOS escalate to a real care team when needed.",
    features: [
      "Health Connect sync with UCUM units",
      "BLE provisioning with QR → PIN → Wi-Fi",
      "Live vitals and 24-hour trends",
      "AI chat with structured health summaries",
      "Video consultations: 15-state flow",
      "SOS escalation with mandatoryPush",
    ],
    screenshots: [
      { src: "/screenshots/screenshot-patient-home.png", alt: "Patient home screen", caption: "patient · home (post-redesign)" },
      { src: "/screenshots/screenshot-patient-iot-devices.png", alt: "My Devices screen with self-assign card", caption: "patient · my devices (self-assign)" },
      { src: "/screenshots/screenshot-patient-vitals.png", alt: "Vitals trends", caption: "patient · vitals trends" },
      { src: "/screenshots/screenshot-patient-ai-chat.png", alt: "AI chat view", caption: "patient · AI chat + artifact" },
      { src: "/screenshots/screenshot-patient-video.png", alt: "In-call screen", caption: "patient · video consult (in-call)" },
    ],
  },
  {
    id: "doctor",
    label: "Doctor app",
    role: "Flutter · Android · iOS",
    roleColor: "var(--color-role-doctor)",
    blurb:
      "For physicians assigned to patients. Needs-attention dashboard, schedule with accept/decline, e-prescription writer, AI assistant and structured review of artifacts the AI produced.",
    features: [
      "Needs-attention dashboard with live countdown",
      "Schedule, 7-day strip and Accept / Decline",
      "Patient roster with assigned care",
      "E-prescription writer with diagnosis",
      "AI assistant + artifact review",
      "Bell badge from real unread count",
    ],
    screenshots: [
      { src: "/screenshots/screenshot-doctor-dashboard.png", alt: "Doctor dashboard post-redesign", caption: "doctor · dashboard (post-redesign)" },
      { src: "/screenshots/screenshot-doctor-schedule.png", alt: "Schedule timeline", caption: "doctor · schedule timeline" },
      { src: "/screenshots/screenshot-doctor-patients.png", alt: "Patients screen", caption: "doctor · assigned patients" },
      { src: "/screenshots/screenshot-doctor-prescription.png", alt: "E-prescription writer", caption: "doctor · e-prescription" },
    ],
  },
  {
    id: "driver",
    label: "Driver app",
    role: "Flutter · Android",
    roleColor: "var(--color-role-driver)",
    blurb:
      "For couriers moving pharmacy orders to patients. Order offers, stop-by-stop live waypoints, delivery + proof capture and earnings ledger.",
    features: [
      "Real-time order offers",
      "Stop-by-stop live waypoints",
      "Proof capture on delivery",
      "Earnings ledger",
      "SOS escalation",
    ],
    screenshots: [
      { src: "/screenshots/screenshot-driver-dashboard.png", alt: "Driver dashboard", caption: "driver · dashboard" },
      { src: "/screenshots/screenshot-driver-orders.png", alt: "Orders list", caption: "driver · orders list" },
      { src: "/screenshots/screenshot-driver-earnings.png", alt: "Earnings ledger", caption: "driver · earnings" },
    ],
    limitations: [
      "Delivery confirmation and trip-complete captures depend on `GET /dispatch/assignments/{id}` — pending.",
    ],
  },
  {
    id: "portal",
    label: "Admin portal",
    role: "Next.js 15 · App Router",
    roleColor: "var(--color-role-portal)",
    blurb:
      "68 authenticated pages of the SmartCura control surface — appointments, pharmacy, emergency, finance, devices, verification, roles and notifications, all wired to live endpoints.",
    features: [
      "Appointments, pharmacy, emergency",
      "Devices and verification queues",
      "Roles + permissions editor",
      "Notifications inbox",
      "Finance + audit logs",
      "Live dashboard KPIs",
    ],
    screenshots: [
      { src: "/screenshots/screenshot-portal-dashboard.png", alt: "Portal dashboard", caption: "portal · dashboard" },
      { src: "/screenshots/screenshot-portal-appointments.png", alt: "Appointments management", caption: "portal · appointments" },
      { src: "/screenshots/screenshot-portal-emergency.png", alt: "Emergency incidents", caption: "portal · emergency incidents" },
      { src: "/screenshots/screenshot-portal-devices.png", alt: "Devices overview", caption: "portal · devices" },
    ],
  },
];

export const metadata = {
  title: "Apps",
  description:
    "The four SmartCura surfaces — patient app, doctor app, driver app and admin portal — with real screenshots, feature lists, and what each one does in the pipeline.",
};

export default function AppsPage() {
  return (
    <>
      <section aria-labelledby="apps-h1" className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-brand-blue)]">
            Four surfaces · one platform
          </p>
          <h1
            id="apps-h1"
            className="mt-3 max-w-[28ch] text-[length:var(--text-display)] font-semibold leading-[1.04] tracking-[-0.02em] text-[var(--color-ink)]"
          >
            Apps that actually open on the devices we own.
          </h1>
          <p className="mt-6 max-w-[60ch] text-[length:var(--text-3)] text-[var(--color-ink-2)]">
            Real screenshots from the running builds — no mockups standing in for
            product. Each surface is identified by a role colour from the brand kit
            and a corresponding figure in the report.
          </p>
        </div>
      </section>

      <PulseDivider className="block h-12 w-full bg-[var(--color-paper)]" variant="long" stroke="var(--color-pulse)" ariaHidden />

      <article className="bg-[var(--color-paper)]">
        <div className="mx-auto max-w-[1180px] px-6 py-12 md:py-20">
          {SURFACES.map((s, sIdx) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`surface-${s.id}-h2`}
              className={sIdx > 0 ? "mt-20 md:mt-28" : ""}
            >
              <header className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div>
                  <span
                    aria-hidden
                    className="block h-1 w-12 rounded-full"
                    style={{ backgroundColor: s.roleColor }}
                  />
                  <h2
                    id={`surface-${s.id}-h2`}
                    className="mt-3 text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink)]"
                  >
                    {s.label}
                  </h2>
                  <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                    {s.role}
                  </p>
                </div>
                <div>
                  <p className="text-[length:var(--text-2)] text-[var(--color-ink-2)]">{s.blurb}</p>
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                    {s.features.map((f) => (
                      <li
                        key={f}
                        className="flex gap-3 rounded-lg border border-[var(--rule-hairline)] bg-white px-4 py-3 text-[14px] text-[var(--color-ink)]"
                      >
                        <span aria-hidden className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.roleColor }} />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </header>

              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {s.screenshots.map((img) => (
                  <FigureImage
                    key={img.src}
                    src={img.src}
                    alt={img.alt}
                    caption={img.caption}
                    aspect="phone"
                  />
                ))}
              </div>

              {s.limitations ? (
                <div className="mt-6 rounded-xl border border-[var(--rule-hairline)] bg-[var(--color-paper-2)]">
                  <header className="flex items-center gap-2 border-b border-[var(--rule-hairline)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink-3)]">
                    <span aria-hidden>⚠</span> Honest limits
                  </header>
                  <ul className="space-y-2 px-5 py-4 text-[14px] text-[var(--color-ink-2)]">
                    {s.limitations.map((l) => (
                      <li key={l} className="flex gap-3">
                        <span aria-hidden className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-ink-3)]" />
                        <span>{l}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </article>

      <section
        aria-labelledby="next-h"
        className="bg-[var(--color-night)] text-[var(--color-ink-inverse)]"
      >
        <div className="mx-auto max-w-[1180px] px-6 py-16 md:py-20">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--color-pulse-night)]/80">
            Want to see the rest?
          </p>
          <h2 id="next-h" className="mt-3 max-w-[36ch] text-[length:var(--text-5)] font-semibold tracking-[-0.01em] text-[var(--color-ink-inverse)]">
            The pipeline behind each surface.
          </h2>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/how-it-works"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-brand-blue)] px-5 py-3 text-[15px] font-semibold text-white hover:bg-[var(--color-brand-blue-strong)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
            >
              How it works <span aria-hidden>→</span>
            </Link>
            <Link
              href="/ai"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--color-ink-inverse)]/30 px-5 py-3 text-[15px] font-semibold text-[var(--color-ink-inverse)] hover:border-[var(--color-pulse-night)] hover:text-[var(--color-pulse-night)] focus-visible:outline-none focus-visible:[outline:var(--focus-ring)] focus-visible:[outline-offset:2px]"
            >
              The AI pipeline <span aria-hidden>→</span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
