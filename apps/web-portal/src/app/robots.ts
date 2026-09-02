import type { MetadataRoute } from "next";

/**
 * Public-host robots. The marketing tree at smartcura.app is indexed; the
 * authenticated portal at portal.smartcura.app and the API at
 * api.smartcura.app are explicitly disallowed.
 *
 * The sitemap is served at /api/sitemap (see src/app/api/sitemap/route.ts).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/api/"],
      },
    ],
    host: "https://smartcura.app",
    sitemap: "https://smartcura.app/api/sitemap",
  };
}
