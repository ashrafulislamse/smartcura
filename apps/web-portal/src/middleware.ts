import { NextRequest, NextResponse } from "next/server";
import { isPublicHost } from "@/lib/site-data";

/**
 * Routes the root URL by host. Public hosts (smartcura.app, www.smartcura.app,
 * local dev) fall through to the marketing home in `app/(public)/page.tsx`.
 * Every other host — chiefly portal.smartcura.app — is redirected to /login,
 * preserving the dashboard's external behaviour.
 *
 * The matcher is restricted to `/` so the middleware is impossible to invoke
 * on any other route; deep portal routes are still gated by
 * `app/(authenticated)/layout.tsx`, and deep public routes live inside the
 * `(public)` group.
 */
export function middleware(request: NextRequest) {
  const host = request.headers.get("host");
  if (isPublicHost(host)) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url, 307);
}

export const config = {
  matcher: "/",
};
