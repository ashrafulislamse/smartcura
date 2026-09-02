/**
 * Identity provider boundary (SDK-neutral).
 *
 * The portal never authenticates users itself and never holds authority over a
 * session. An external identity provider verifies credentials and issues an
 * identity token; the backend exchanges that token for an application session
 * (`POST /sessions`) and owns every decision after that.
 *
 * No identity SDK is installed or configured in this repository. Nothing here
 * claims otherwise. To wire a real provider, implement `IdentityProvider` in a
 * separate module and register it with `configureIdentityProvider()` during
 * application startup.
 */

export const IDENTITY_PROVIDER_NOT_CONFIGURED_MESSAGE =
  'The identity provider is not configured for this portal. Sign-in and step-up ' +
  'verification require an IdentityProvider implementation registered via ' +
  'configureIdentityProvider().';

export interface IdentityCredentials {
  email: string;
  password: string;
}

/** Optional second factor / re-entered credential material for reauthentication. */
export interface ReauthenticateOptions {
  email?: string;
  password?: string;
  otp?: string;
}

/**
 * Result of a credential sign-in at the identity provider.
 * `mfaRequired` is reported by the provider, not decided by the browser: when it
 * is true the portal routes to step-up verification instead of pretending the
 * user is fully authenticated.
 */
export interface IdentitySignInResult {
  idToken: string;
  mfaRequired: boolean;
}

export interface IdentityProvider {
  /**
   * Primary sign-in entry point. Verifies the credentials with the identity
   * provider and returns the issued identity token plus whether the provider
   * still requires a second factor. The token is forwarded to `POST /sessions`
   * and is never persisted by the portal (no localStorage, no sessionStorage,
   * no cookie).
   */
  signIn(email: string, password: string): Promise<IdentitySignInResult>;

  /**
   * Convenience wrapper around {@link IdentityProvider.signIn} for call sites
   * that only need the identity token.
   */
  signInWithEmailPassword(credentials: IdentityCredentials): Promise<string>;

  /** Returns the current identity token, refreshing it when the provider allows. */
  getIdToken(): Promise<string>;

  /**
   * Reauthenticates the current identity (typically with MFA) and returns a
   * freshly issued identity token for `POST /sessions/step-up`.
   */
  reauthenticate(options?: ReauthenticateOptions): Promise<string>;
}

export class IdentityProviderNotConfiguredError extends Error {
  readonly code = 'IDENTITY_PROVIDER_NOT_CONFIGURED';

  constructor(message: string = IDENTITY_PROVIDER_NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = 'IdentityProviderNotConfiguredError';
  }
}

/**
 * The only implementation shipped in this repository. Every method throws, so no
 * screen can fake authentication in the browser. Do not add fallback behaviour.
 */
export class NotConfiguredIdentityProvider implements IdentityProvider {
  async signIn(): Promise<IdentitySignInResult> {
    throw new IdentityProviderNotConfiguredError();
  }

  async signInWithEmailPassword(): Promise<string> {
    throw new IdentityProviderNotConfiguredError();
  }

  async getIdToken(): Promise<string> {
    throw new IdentityProviderNotConfiguredError();
  }

  async reauthenticate(): Promise<string> {
    throw new IdentityProviderNotConfiguredError();
  }
}

export const notConfiguredIdentityProvider: IdentityProvider = new NotConfiguredIdentityProvider();

let activeProvider: IdentityProvider = notConfiguredIdentityProvider;

export function configureIdentityProvider(provider: IdentityProvider): void {
  activeProvider = provider;
}

export function resetIdentityProvider(): void {
  activeProvider = notConfiguredIdentityProvider;
}

export function getIdentityProvider(): IdentityProvider {
  return activeProvider;
}

export function isIdentityProviderConfigured(): boolean {
  return !(activeProvider instanceof NotConfiguredIdentityProvider);
}
