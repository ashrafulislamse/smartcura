/**
 * Development-only identity provider.
 *
 * Returns a fixed opaque token that the backend's `local` identity adapter is
 * configured to accept, so the whole application-session flow (bootstrap,
 * onboarding, membership selection, refresh, step-up, logout) can be exercised in
 * a browser without a real identity provider.
 *
 * This is NOT an authentication mechanism. It performs no credential check: any
 * email and password are accepted, and the backend decides everything that
 * follows. Two independent controls keep it out of production:
 *
 * 1. It is only registered when `NEXT_PUBLIC_DEV_IDENTITY_TOKEN` is set, which no
 *    production build should define.
 * 2. The backend refuses to start with `SMARTCURA_IDENTITY_ADAPTER=local` outside
 *    development, so a fixture token cannot be exchanged for a session against a
 *    production API even if this provider were somehow registered.
 *
 * A visible banner is rendered while it is active so no one mistakes a fixture
 * session for a real one.
 */

import {
  IdentityProviderNotConfiguredError,
  type IdentityProvider,
  type IdentityCredentials,
  type IdentitySignInResult,
  type ReauthenticateOptions,
} from './identity-provider';

export const DEV_IDENTITY_TOKEN_ENV = 'NEXT_PUBLIC_DEV_IDENTITY_TOKEN';

export class FixtureIdentityProvider implements IdentityProvider {
  constructor(private readonly token: string) {
    if (token.trim().length === 0) {
      throw new IdentityProviderNotConfiguredError(
        'A development identity token is required to use the fixture provider.',
      );
    }
  }

  /**
   * Accepts any credentials. `mfaRequired` is false because the backend's local
   * adapter already reports MFA as satisfied, so it issues a step-up window on
   * session creation and no second-factor screen is needed.
   */
  async signIn(_email: string, _password: string): Promise<IdentitySignInResult> {
    return { idToken: this.token, mfaRequired: false };
  }

  async signInWithEmailPassword(_credentials: IdentityCredentials): Promise<string> {
    return this.token;
  }

  async getIdToken(): Promise<string> {
    return this.token;
  }

  /**
   * Returns the same token. A real provider reauthenticates the user with a second
   * factor here; the backend still decides whether the resulting step-up is
   * granted, so the server-side rule remains the one under test.
   */
  async reauthenticate(_options?: ReauthenticateOptions): Promise<string> {
    return this.token;
  }
}

/** The configured development token, or undefined when the fixture is disabled. */
export function developmentIdentityToken(): string | undefined {
  const token = process.env.NEXT_PUBLIC_DEV_IDENTITY_TOKEN?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}
