import { createHmac, randomUUID } from 'node:crypto';
import type { ApiConfig } from '../config.js';

export interface ConsultationRoomGrant {
  readonly roomName: string;
  readonly participantIdentity: string;
}

export interface ConsultationRoomToken {
  readonly server_url: string;
  readonly access_token: string;
  readonly expires_at: string;
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

export class LiveKitTokenService {
  constructor(private readonly config: ApiConfig['video']) {}

  mint(grant: ConsultationRoomGrant, now = new Date()): ConsultationRoomToken {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = issuedAt + this.config.tokenTtlSeconds;
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
      iss: this.config.apiKey,
      sub: grant.participantIdentity,
      iat: issuedAt,
      nbf: issuedAt - 5,
      exp: expiresAt,
      jti: randomUUID(),
      video: {
        roomJoin: true,
        room: grant.roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      },
    }));
    const unsigned = `${header}.${payload}`;
    const signature = createHmac('sha256', this.config.apiSecret)
      .update(unsigned).digest('base64url');
    return {
      server_url: this.config.url,
      access_token: `${unsigned}.${signature}`,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    };
  }
}
