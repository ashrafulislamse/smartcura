import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  FILE_SCAN_COMPLETED_EVENT_TYPE,
  FILE_SCAN_REQUESTED_EVENT_TYPE,
  type FileScanRecord,
  type VerificationFileDownloadContext,
} from '../packages/database/src/index.js';
import {
  DeterministicMalwareScanner,
  hasExpectedFileSignature,
  type ObjectStorageProvider,
  type PrivateFileStorageProvider,
  type StoredObject,
} from '../packages/storage/src/index.js';
import { OutboxProcessor } from '../apps/worker/src/outbox.processor.js';
import { PrivateFileScanHandler } from '../apps/worker/src/private-file-scan.handler.js';
import {
  PrivateFilesService,
  verificationFileAccessAllowed,
} from '../apps/api/src/verification/private-files.service.js';
import type { AuthenticatedSession } from '../apps/api/src/platform/request-authorization.js';

const objectId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d10';
const documentId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d11';
const membershipId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d12';
const organizationId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d13';
const otherOrganizationId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d14';
const ownerProfileId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d15';
const otherProfileId = '018f5f5d-4f7b-7d20-9c8a-7e4b5f7e2d16';

const cleanPdf = Buffer.from('%PDF-1.7\nsynthetic verification file', 'ascii');
const eicarPdf = Buffer.from(
  '%PDF-1.7\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
  'ascii',
);

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

test('verification file signatures are allowlisted and deterministic scanner detects EICAR', async () => {
  assert.equal(hasExpectedFileSignature('application/pdf', cleanPdf), true);
  assert.equal(hasExpectedFileSignature('image/jpeg', Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)), true);
  assert.equal(hasExpectedFileSignature(
    'image/png', Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  ), true);
  assert.equal(hasExpectedFileSignature('application/pdf', Buffer.from('<html>')), false);
  assert.equal(hasExpectedFileSignature('image/svg+xml', Buffer.from('<svg>')), false);

  const scanner = new DeterministicMalwareScanner();
  assert.equal((await scanner.scan(cleanPdf)).verdict, 'clean');
  assert.deepEqual(await scanner.scan(eicarPdf), {
    verdict: 'infected', signature: 'EICAR-Test-Signature',
  });
});

test('scan handler promotes only clean bytes and quarantines infected or disguised files', async () => {
  for (const scenario of [
    { bytes: cleanPdf, expectedState: 'clean', expectedReason: 'SCAN_CLEAN' },
    { bytes: eicarPdf, expectedState: 'infected', expectedReason: 'MALWARE_DETECTED' },
    { bytes: Buffer.from('<html>not a pdf'), expectedState: 'scan_failed',
      expectedReason: 'FILE_SIGNATURE_MISMATCH' },
  ] as const) {
    const digest = sha(scenario.bytes);
    const claimed: FileScanRecord = {
      objectId,
      organizationId,
      objectKey: `verification/${organizationId}/${objectId}`,
      contentType: 'application/pdf',
      byteSize: scenario.bytes.byteLength,
      verifiedSha256: digest,
    };
    const completions: unknown[][] = [];
    const repository = {
      claimScan: async () => claimed,
      completeScan: async (...args: unknown[]) => {
        completions.push(args);
        return 'completed' as const;
      },
    };
    const stored: StoredObject = {
      key: claimed.objectKey,
      contentType: claimed.contentType,
      size: scenario.bytes.byteLength,
      sha256: digest,
      etag: `sha256:${digest}`,
      bytes: Uint8Array.from(scenario.bytes),
    };
    const storage = { get: async () => stored };
    const handler = new PrivateFileScanHandler(
      repository as never,
      storage as never,
      new DeterministicMalwareScanner(),
    );
    assert.equal(await handler.handle(objectId), true);
    assert.equal(completions.length, 1);
    assert.equal(completions[0]?.[1], scenario.expectedState);
    assert.equal(completions[0]?.[2], scenario.expectedReason);
  }
});

test('worker accepts minimum-data scan events and rejects extra fields', async () => {
  const handled: string[] = [];
  const processor = new OutboxProcessor({
    handle: async (id: string) => { handled.push(id); return true; },
  } as PrivateFileScanHandler);
  assert.equal(await processor.process({
    eventId: objectId,
    eventType: FILE_SCAN_REQUESTED_EVENT_TYPE,
    eventVersion: 1,
    attempts: 1,
    payload: { object_id: objectId },
  }), true);
  assert.deepEqual(handled, [objectId]);
  assert.equal(await processor.process({
    eventId: objectId,
    eventType: FILE_SCAN_COMPLETED_EVENT_TYPE,
    eventVersion: 1,
    attempts: 1,
    payload: { object_id: objectId, scan_state: 'clean', downloadable: true },
  }), true);
  assert.equal(await processor.process({
    eventId: objectId,
    eventType: FILE_SCAN_COMPLETED_EVENT_TYPE,
    eventVersion: 1,
    attempts: 1,
    payload: { object_id: objectId, scan_state: 'clean', downloadable: false },
  }), false);
  assert.equal(await processor.process({
    eventId: objectId,
    eventType: FILE_SCAN_REQUESTED_EVENT_TYPE,
    eventVersion: 1,
    attempts: 1,
    payload: { object_id: objectId, object_key: 'must-not-fan-out' },
  }), false);
});

test('verification file policy preserves owner, organization, global, and unrelated boundaries', () => {
  const context = downloadContext();
  assert.equal(verificationFileAccessAllowed(session('owner'), context), true);
  assert.equal(verificationFileAccessAllowed(session('unrelated'), context), false);
  assert.equal(verificationFileAccessAllowed(session('admin'), context), true);
  assert.equal(verificationFileAccessAllowed(session('cross-org-admin'), context), false);
  assert.equal(verificationFileAccessAllowed(session('super-admin'), context), true);
});

test('download service never signs unrelated or quarantined objects and returns no object key', async () => {
  for (const scenario of [
    { actor: 'unrelated' as const, context: downloadContext(), code: 'RESOURCE_NOT_FOUND' },
    { actor: 'owner' as const, context: downloadContext({
      uploadState: 'quarantined', scanState: 'infected', downloadable: false,
    }), code: 'OBJECT_NOT_DOWNLOADABLE' },
  ]) {
    let signed = 0;
    const service = privateFilesService(scenario.context, () => { signed += 1; });
    await assert.rejects(
      service.downloadVerificationDocument(session(scenario.actor), membershipId, documentId),
      (error: unknown) => error instanceof Error && error.message === scenario.code,
    );
    assert.equal(signed, 0);
  }

  let signed = 0;
  let expirySeconds: number | undefined;
  const response = await privateFilesService(downloadContext(), (seconds) => {
    signed += 1;
    expirySeconds = seconds;
  })
    .downloadVerificationDocument(session('owner'), membershipId, documentId);
  assert.equal(signed, 1);
  assert.equal(expirySeconds, 60);
  assert.equal((response['download'] as Record<string, unknown>)['method'], 'GET');
  assert.equal(JSON.stringify(response).includes('object_key'), false);
});

function downloadContext(
  patch: Partial<VerificationFileDownloadContext> = {},
): VerificationFileDownloadContext {
  return {
    documentId,
    membershipId,
    organizationId,
    ownerProfileId,
    objectId,
    objectKey: `verification/${organizationId}/${membershipId}/${objectId}`,
    contentType: 'application/pdf',
    byteSize: cleanPdf.byteLength,
    verifiedSha256: sha(cleanPdf),
    uploadState: 'finalized',
    scanState: 'clean',
    downloadable: true,
    ...patch,
  };
}

function session(
  kind: 'owner' | 'unrelated' | 'admin' | 'cross-org-admin' | 'super-admin',
): AuthenticatedSession {
  const profileId = kind === 'owner' ? ownerProfileId : otherProfileId;
  const activeMembershipId = kind === 'owner' ? membershipId : objectId;
  const membership = kind === 'owner'
    ? {
        membershipId,
        organizationId,
        roleId: 'doctor',
        status: 'applied',
        permissions: ['file.object:read:own'],
      }
    : {
        membershipId: activeMembershipId,
        organizationId: kind === 'cross-org-admin' ? otherOrganizationId : organizationId,
        roleId: kind === 'super-admin' ? 'super_admin' : kind.includes('admin') ? 'admin' : 'doctor',
        status: 'active',
        permissions: kind === 'super-admin'
          ? ['file.object:read:global']
          : kind.includes('admin')
            ? ['file.object:read:organization']
            : ['file.object:read:own'],
      };
  return {
    tokenHash: 'hash',
    aggregate: {
      profile: {
        profileId,
        status: 'active',
        onboardingCompletedAt: new Date('2026-07-29T00:00:00.000Z'),
      },
      session: { activeMembershipId },
      memberships: [membership],
    },
  } as unknown as AuthenticatedSession;
}

function privateFilesService(
  context: VerificationFileDownloadContext,
  onSign: (expiresInSeconds: number | undefined) => void,
): PrivateFilesService {
  const files = { loadVerificationDownload: async () => context };
  const authorization = {
    touch: async (current: AuthenticatedSession) => current,
    deny: async (_current: unknown, _action: string, _status: number, code: string) => {
      throw new Error(code);
    },
  };
  const operation = {
    method: 'GET' as const,
    url: new URL('https://example.invalid/private?signature=synthetic'),
    expiresAt: new Date('2026-07-29T00:01:00.000Z'),
    requiredHeaders: {},
  };
  const storage: PrivateFileStorageProvider = {
    put: async () => { throw new Error('unused'); },
    get: async () => { throw new Error('unused'); },
    head: async () => undefined,
    delete: async () => false,
    createPresignedUploadUrl: async () => { throw new Error('unused'); },
    createPresignedDownloadUrl: async (_key, expiresInSeconds) => {
      onSign(expiresInSeconds);
      return operation;
    },
    headObject: async () => undefined,
  };
  return new PrivateFilesService(
    files as never,
    authorization as never,
    storage as ObjectStorageProvider,
    { objectStorage: { provider: 'r2' } } as never,
  );
}
