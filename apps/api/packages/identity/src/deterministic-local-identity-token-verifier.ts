import {
  IdentityTokenVerificationError,
  type IdentityTokenVerifier,
  type VerifiedIdentity,
} from './identity-token-verifier.js';

interface NormalizedIdentity {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly authTimeMilliseconds: number;
  readonly mfaSatisfied: boolean;
}

export interface DeterministicLocalIdentityOptions {
  /**
   * Reports `authTime` as the moment of verification rather than the fixture's
   * fixed value.
   *
   * A real identity provider issues a token whose `auth_time` reflects the
   * authentication that just occurred. Step-up requires authentication within the
   * last five minutes, so a fixture pinned to process start makes step-up
   * impossible once the process has been running longer than that. Enabling this
   * models provider behaviour; leaving it off keeps verification fully
   * deterministic for tests that assert on an exact timestamp.
   */
  readonly authenticatedAtVerificationTime?: boolean;
}

export class DeterministicLocalIdentityTokenVerifier implements IdentityTokenVerifier {
  readonly #fixtures: ReadonlyMap<string, NormalizedIdentity>;
  readonly #authenticatedAtVerificationTime: boolean;
  readonly #now: () => Date;

  constructor(
    fixtures: ReadonlyMap<string, VerifiedIdentity>,
    options: DeterministicLocalIdentityOptions = {},
    now: () => Date = () => new Date(),
  ) {
    this.#fixtures = new Map(
      [...fixtures].map(([token, identity]) => [token, normalizeIdentity(identity)]),
    );
    this.#authenticatedAtVerificationTime = options.authenticatedAtVerificationTime === true;
    this.#now = now;
  }

  async verify(idToken: string): Promise<VerifiedIdentity> {
    if (idToken.trim().length === 0) throw new IdentityTokenVerificationError();

    const identity = this.#fixtures.get(idToken);
    if (identity === undefined) throw new IdentityTokenVerificationError();

    if (!this.#authenticatedAtVerificationTime) return toVerifiedIdentity(identity);
    return toVerifiedIdentity({ ...identity, authTimeMilliseconds: this.#now().getTime() });
  }
}

function normalizeIdentity(identity: VerifiedIdentity): NormalizedIdentity {
  return Object.freeze({
    uid: identity.uid,
    email: identity.email,
    emailVerified: identity.emailVerified,
    authTimeMilliseconds: identity.authTime.getTime(),
    mfaSatisfied: identity.mfaSatisfied,
  });
}

function toVerifiedIdentity(identity: NormalizedIdentity): VerifiedIdentity {
  return Object.freeze({
    uid: identity.uid,
    email: identity.email,
    emailVerified: identity.emailVerified,
    authTime: Object.freeze(new Date(identity.authTimeMilliseconds)),
    mfaSatisfied: identity.mfaSatisfied,
  });
}
