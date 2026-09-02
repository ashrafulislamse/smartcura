export interface VerifiedIdentity {
  readonly uid: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly authTime: Date;
  readonly mfaSatisfied: boolean;
}

export interface IdentityTokenVerifier {
  verify(idToken: string): Promise<VerifiedIdentity>;
}

export class IdentityTokenVerificationError extends Error {
  constructor() {
    super('Identity token verification failed');
    this.name = 'IdentityTokenVerificationError';
  }
}
