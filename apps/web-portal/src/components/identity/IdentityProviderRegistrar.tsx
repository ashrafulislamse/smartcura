'use client';

/**
 * Identity provider registrar.
 *
 * Mounts once at the root of the app and replaces the default
 * `NotConfiguredIdentityProvider` with a real `FirebaseIdentityProvider` so the
 * login and step-up screens can call `getIdentityProvider().signIn(...)` and
 * receive a Firebase ID token.
 *
 * The actual `configureIdentityProvider()` call is wrapped in a render-effect
 * guard so it runs exactly once per page load even under React strict mode.
 *
 * If the build is missing the `NEXT_PUBLIC_FIREBASE_*` env vars, the default
 * `NotConfiguredIdentityProvider` stays in place and the existing "not
 * configured" error is shown on the login screen — the same behaviour as before
 * this module existed. No silent failure mode is added.
 */

import { useEffect, useRef } from 'react';
import { configureIdentityProvider } from '@/lib/identity/identity-provider';
import { FirebaseIdentityProvider } from '@/lib/identity/firebase-identity-provider';

export default function IdentityProviderRegistrar(): null {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;
    configureIdentityProvider(new FirebaseIdentityProvider());
  }, []);

  return null;
}
