export {
  calculateSignature,
  createCanonicalRequest,
  createCredentialScope,
  createStringToSign,
  deriveSigningKey,
  encodeCanonicalPath,
  encodeRfc3986,
  formatAmzDate,
  formatDateStamp,
  presignRequestUrl,
  signRequestWithAuthorizationHeader,
  EMPTY_PAYLOAD_SHA256,
  SIGV4_ALGORITHM,
  UNSIGNED_PAYLOAD,
  type SigV4CanonicalRequest,
  type SigV4Credentials,
  type SigV4PresignedUrl,
  type SigV4RequestTarget,
  type SigV4SignedHeaders,
  type SigV4SigningParameters,
} from './aws-signature-v4.js';
export {
  loadObjectStorageConfig,
  type ObjectStorageConfig,
  type ObjectStorageEnvironment,
} from './config.js';
export { InMemoryObjectStorage } from './in-memory-object-storage.js';
export { assertObjectKey } from './object-key.js';
export {
  createObjectStorageProvider,
  createObjectStorageProviderFromEnv,
  supportsPresignedOperations,
  supportsPrivateFilePipeline,
  type ObjectStorageProviderOptions,
} from './object-storage-factory.js';
export {
  ObjectChecksumMismatchError,
  ObjectChecksumUnavailableError,
  ObjectNotFoundError,
  ObjectStorageRequestError,
  type CopyObjectRequest,
  type ObjectStorageFailureReason,
  type ObjectStorageProvider,
  type PresignedObjectOperation,
  type PresignedObjectStorageProvider,
  type PresignedUploadRequest,
  type PrivateFileStorageProvider,
  type PrivateObjectHead,
  type PutObjectRequest,
  type RemoteObjectStorageProvider,
  type StoredObject,
  type StoredObjectMetadata,
} from './object-storage.js';
export {
  R2ObjectStorage,
  DEFAULT_PRESIGNED_EXPIRY_SECONDS,
  DEFAULT_PRIVATE_FILE_PRESIGNED_EXPIRY_SECONDS,
  MAXIMUM_PRESIGNED_EXPIRY_SECONDS,
  MAXIMUM_PRIVATE_FILE_PRESIGNED_EXPIRY_SECONDS,
  R2_SIGNING_REGION,
  R2_SIGNING_SERVICE,
  type R2ObjectStorageOptions,
} from './r2-object-storage.js';

export {
  ClamAvMalwareScanner,
  DeterministicMalwareScanner,
  MalwareScannerUnavailableError,
  hasExpectedFileSignature,
  type ClamAvMalwareScannerOptions,
  type MalwareScanner,
  type MalwareScanResult,
  type MalwareScanVerdict,
} from './malware-scanner.js';
