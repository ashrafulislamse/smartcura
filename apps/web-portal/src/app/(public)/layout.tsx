import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "@/styles/site-tokens.css";
import { PublicNav } from "@/components/public/nav";
import { PublicFooter } from "@/components/public/footer";
import { LIVE_HREFS } from "@/lib/site-data";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-data-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SmartCura — IoT + AI telehealth, verified end-to-end",
    template: "%s · SmartCura",
  },
  description:
    "SmartCura is an AI-powered healthcare platform: ESP32 vitals monitoring, an AI health-summary pipeline, video consultations, e-prescriptions, pharmacy delivery and emergency response — verified end-to-end on live infrastructure, on synthetic data.",
  applicationName: "SmartCura",
  authors: [{ name: "Md Ashraful Islam" }],
  generator: "Next.js",
  keywords: [
    "AI healthcare platform",
    "digital health",
    "remote patient monitoring",
    "telemedicine",
    "ESP32",
    "health monitoring",
    "healthcare IoT",
    "AI medical summary",
  ],
  referrer: "strict-origin-when-cross-origin",
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    siteName: "SmartCura",
    title: "SmartCura — IoT + AI telehealth, verified end-to-end",
    description:
      "An end-to-end prototype: signal from a sensor, structure from an AI, a hand to receive it.",
  },
  twitter: {
    card: "summary_large_image",
    title: "SmartCura — IoT + AI telehealth",
    description:
      "An end-to-end prototype: signal from a sensor, structure from an AI, a hand to receive it.",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9FAFB" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Layout for the public (unauthenticated) marketing site. Hosts that resolve to
 * the apex (smartcura.app, www.smartcura.app, local dev) are routed here at
 * the root page via the host-aware redirect in src/app/page.tsx.
 *
 * The layout is intentionally lean: just fonts, nav and footer. Public pages
 * must not pull from the dashboard's component tree; keeping imports out of
 * `public/` keeps the public bundle clean.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`public-root ${mono.variable}`}
      style={{
        // Always present on the public site so it never accidentally inherits a
        // dark dashboard body background from ancestor globals.css.
        fontFamily: "var(--font-body)",
        color: "var(--color-ink)",
        backgroundColor: "var(--color-paper)",
      }}
    >
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-white focus-visible:px-4 focus-visible:py-2 focus-visible:text-[var(--color-ink)] focus-visible:[outline:var(--focus-ring)]"
      >
        Skip to main content
      </a>
      <PublicNav />
      <main id="main" className="pt-[88px] md:pt-[88px]">
        {children}
      </main>
      <PublicFooter liveHrefs={LIVE_HREFS} />
    </div>
  );
}
