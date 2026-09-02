import { NextResponse } from "next/server";

const PUBLIC_BASE = "https://smartcura.app";

const PATHS: ReadonlyArray<string> = [
  "/",
  "/how-it-works",
  "/apps",
  "/ai",
  "/security",
  "/project",
  "/demo",
  "/privacy",
  "/terms",
  "/medical-disclaimer",
];

/**
 * Public-host sitemap. Only indexes the marketing surface; the authenticated
 * portal tree (portal.smartcura.app) is intentionally excluded because those
 * routes require sign-in and should never be crawled.
 *
 * Served at /api/sitemap on the public host for crawlers that prefer a static
 * endpoint. Matched by robots.ts in the same app.
 */
export function GET(): NextResponse {
  const lastmod = new Date().toISOString();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    PATHS
      .map(
        (p) =>
          `  <url>\n    <loc>${PUBLIC_BASE}${p}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>${p === "/" ? "1.0" : "0.7"}</priority>\n  </url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}
