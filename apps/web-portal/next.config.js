/**
 * The portal must be same-origin with the API for the backend's
 * `__Host-smartcura_session` cookie to be accepted: `__Host-` cookies require
 * Path=/, Secure and no Domain attribute, so they cannot be shared across origins.
 * Requests therefore go to the relative path `/api/v1/*` and Next.js proxies them
 * to the backend origin below.
 *
 * IMPORTANT: `SMARTCURA_API_ORIGIN` is read here at BUILD time, so it must be
 * marked "Available at Buildtime" in Coolify. Runtime-only env vars are not
 * visible when `next.config.js` is evaluated and the rewrite destination will
 * silently fall back to `http://localhost:3000`, which does not work in production.
 */
const apiOrigin = (process.env.SMARTCURA_API_ORIGIN || 'http://localhost:3000').replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost', 'firebasestorage.googleapis.com'],
  },
  env: {
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiOrigin}/api/v1/:path*`,
      },
    ];
  },
}

module.exports = nextConfig
