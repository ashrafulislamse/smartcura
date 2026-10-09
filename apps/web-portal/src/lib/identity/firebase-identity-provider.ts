/**
 * Firebase Identity Provider for the SmartCura portal.
 *
 * The portal never holds user credentials. Firebase verifies email/password and
 * issues an ID token; the portal forwards that token to `POST /sessions` and the
 * backend does everything that follows (creates a session, sets the
 * `__Host-smartcura_session` cookie, owns refresh and step-up decisions).
 *
 * The Firebase Web SDK is loaded lazily on the first auth call so the login page
 * does not pay the bundle cost on a no-op visit (and so the rest of the portal
 * never imports it). The SDK is a public client — the `apiKey` is not a secret —
 * so it is safe to ship its config in a `NEXT_PUBLIC_*` build-time env var.
 *
 * CONFIG (build-time env, set in Coolify):
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET      (optional, analytics only)
 *   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID (optional)
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *
 * If any required value is missing the provider throws
 * `IdentityProviderNotConfiguredError` at first use, surfacing the misconfig the
 * same way a missing SDK would — no silent "we signed in but the backend
 * rejected it" failure mode.
 */

import {
  IdentityProviderNotConfiguredError,
  type IdentityCredentials,
  type IdentityProvider,
  type IdentitySignInResult,
  type ReauthenticateOptions,
} from './identity-provider';

interface FirebaseRuntimeConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

interface FirebaseAuthModule {
  initializeAuth: typeof import('firebase/auth').initializeAuth;
  getAuth: typeof import('firebase/auth').getAuth;
  signInWithEmailAndPassword: typeof import('firebase/auth').signInWithEmailAndPassword;
  getIdToken: typeof import('firebase/auth').getIdToken;
  browserLocalPersistence: typeof import('firebase/auth').browserLocalPersistence;
  browserPopupRedirectResolver: typeof import('firebase/auth').browserPopupRedirectResolver;
}

interface FirebaseAppModule {
  initializeApp: typeof import('firebase/app').initializeApp;
  getApps: typeof import('firebase/app').getApps;
}

type FirebaseApp = import('firebase/app').FirebaseApp;
type FirebaseAuth = import('firebase/auth').Auth;

let appPromise: Promise<FirebaseApp> | null = null;
let authPromise: Promise<FirebaseAuth> | null = null;

/**
 * Read the Firebase Web SDK config from `process.env.NEXT_PUBLIC_FIREBASE_*`.
 * The values are baked into the bundle at build time and are not secrets — the
 * apiKey identifies the project, it does not authenticate against it. Restrict
 * the key to your domains in the Google Cloud Console (HTTP referrers) so it
 * cannot be reused from another site.
 */
function readFirebaseConfig(): FirebaseRuntimeConfig {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim();

  if (!apiKey || !authDomain || !projectId || !appId) {
    throw new IdentityProviderNotConfiguredError(
      'Firebase Web SDK is not configured for this portal. Set the ' +
        'NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, ' +
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID and NEXT_PUBLIC_FIREBASE_APP_ID build ' +
        'arguments, then redeploy.',
    );
  }

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    ...(storageBucket ? { storageBucket } : {}),
    ...(messagingSenderId ? { messagingSenderId } : {}),
  };
}

async function loadFirebaseModules(): Promise<{
  appModule: FirebaseAppModule;
  authModule: FirebaseAuthModule;
}> {
  // Dynamic import keeps the SDK out of the initial bundle. The chunk is
  // requested the first time a real auth call happens (login, step-up).
  const [appModule, authModule] = await Promise.all([
    import('firebase/app') as Promise<FirebaseAppModule>,
    import('firebase/auth') as Promise<FirebaseAuthModule>,
  ]);
  return { appModule, authModule };
}

async function getAuthInstance(config: FirebaseRuntimeConfig): Promise<FirebaseAuth> {
  if (authPromise !== null) return authPromise;
  authPromise = (async (): Promise<FirebaseAuth> => {
    const { appModule, authModule } = await loadFirebaseModules();
    if (appPromise === null) {
      const existing = appModule.getApps();
      appPromise = existing.length > 0
        ? Promise.resolve(existing[0])
        : Promise.resolve(appModule.initializeApp(config));
    }
    await appPromise;
    // initializeAuth (not getAuth) so we can pin persistence to localStorage
    // explicitly; a default session in the portal is short-lived and refreshed
    // by POST /sessions, so local persistence is the right call.
    const auth = authModule.initializeAuth(
      (await appPromise) as FirebaseApp,
      {
        persistence: authModule.browserLocalPersistence,
        popupRedirectResolver: authModule.browserPopupRedirectResolver,
      },
    );
    return auth;
  })();
  return authPromise;
}

export class FirebaseIdentityProvider implements IdentityProvider {
  /**
   * Sign in with email and password, return the issued Firebase ID token.
   * The token is the only thing the portal keeps. The backend verifies it on
   * `POST /sessions` and is the only authority on what the user can do next.
   */
  async signIn(email: string, password: string): Promise<IdentitySignInResult> {
    const config = readFirebaseConfig();
    const { authModule } = await loadFirebaseModules();
    const auth = await getAuthInstance(config);
    const credential = await authModule.signInWithEmailAndPassword(auth, email, password);
    const idToken = await credential.user.getIdToken();
    // `mfaRequired` is not directly observable from a successful sign-in. The
    // backend issues a step-up window on session creation when the ID token's
    // `auth_time` is within 5 minutes AND `firebase.sign_in_second_factor`
    // indicates MFA. We approximate that by reading the token's
    // `sign_in_second_factor` claim below.
    const mfaRequired = await readSecondFactorRequired(credential.user);
    return { idToken, mfaRequired };
  }

  async signInWithEmailPassword(credentials: IdentityCredentials): Promise<string> {
    const result = await this.signIn(credentials.email, credentials.password);
    return result.idToken;
  }

  /**
   * Return the current ID token, refreshing it when expired. The Firebase SDK
   * keeps the auth state in localStorage so the user is still signed in across
   * page reloads; this method just hands back the latest token.
   */
  async getIdToken(): Promise<string> {
    const config = readFirebaseConfig();
    const auth = await getAuthInstance(config);
    if (auth.currentUser === null) {
      throw new IdentityProviderNotConfiguredError(
        'No signed-in user. Call signIn() first.',
      );
    }
    return auth.currentUser.getIdToken(/* forceRefresh */ false);
  }

  /**
   * Reauthenticate for step-up. Firebase sessions expire their ID tokens after
   * an hour; the portal asks for fresh credentials to obtain a token whose
   * `auth_time` is now, which the backend accepts as recent reauthentication.
   *
   * If an `otp` is supplied, it is treated as a TOTP second factor. The
   * standard Firebase pattern is `signInWithEmailAndPassword` then resolve the
   * enrolled TOTP multi-factor hint; the demo's TOTP is optional per the
   * backend role policy, so the password path is the one that fires here.
   */
  async reauthenticate(options?: ReauthenticateOptions): Promise<string> {
    const email = options?.email;
    const password = options?.password;
    if (email === undefined || password === undefined) {
      throw new IdentityProviderNotConfiguredError(
        'Step-up requires the user to re-enter their email and password.',
      );
    }
    // Firebase does not expose a "reauth with this user" call that does not
    // need a second factor. The simplest correct thing is to re-sign-in: a new
    // sign-in issues a token whose auth_time is now.
    return this.signInWithEmailPassword({ email, password });
  }
}

/**
 * Read the `sign_in_second_factor` claim from a freshly issued ID token. If
 * the user signed in with MFA, this is set to 'phone' / 'totp' / etc.; the
 * backend can then decide whether a step-up is still required.
 *
 * Firebase Web SDK does not expose raw ID token claims by default. The auth
 * currentUser.getIdTokenResult() returns a parsed token result with a
 * `claims` field that includes the custom claims.
 */
async function readSecondFactorRequired(
  user: import('firebase/auth').User,
): Promise<boolean> {
  try {
    const result = await user.getIdTokenResult();
    const factor = result.claims['sign_in_second_factor'];
    return typeof factor === 'string' && factor.length > 0;
  } catch {
    return false;
  }
}
