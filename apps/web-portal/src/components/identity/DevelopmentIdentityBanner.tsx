'use client';

/**
 * Registers the development fixture identity provider and makes its use obvious.
 *
 * Registration happens in a client component during the first render pass so it is
 * in place before any sign-in screen calls `getIdentityProvider()`. When no
 * development token is configured this renders nothing and registers nothing, so
 * the portal keeps its fail-closed `NotConfiguredIdentityProvider` default.
 */

import { useEffect, useState } from 'react';
import { configureIdentityProvider, isIdentityProviderConfigured } from '@/lib/identity/identity-provider';
import { FixtureIdentityProvider, developmentIdentityToken } from '@/lib/identity/fixture-identity-provider';

const token = developmentIdentityToken();
if (token !== undefined && !isIdentityProviderConfigured()) {
  configureIdentityProvider(new FixtureIdentityProvider(token));
}

export default function DevelopmentIdentityBanner() {
  const [visible, setVisible] = useState(false);

  // Rendered after mount so the server and client markup agree.
  useEffect(() => {
    setVisible(developmentIdentityToken() !== undefined);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-amber-950 shadow-lg"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[14px]">
        warning
      </span>
      Development identity fixture active — credentials are not verified. Not for production use.
    </div>
  );
}
