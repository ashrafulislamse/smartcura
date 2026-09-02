export const API_CONFIG = Symbol('API_CONFIG');
export const IDENTITY_TOKEN_VERIFIER = Symbol('IDENTITY_TOKEN_VERIFIER');
/**
 * Object storage is injected as the provider-neutral `ObjectStorageProvider`
 * interface, never as a concrete adapter, so no route can reach an R2 client
 * directly and a storage move stays a change to the factory alone.
 */
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
