export const WORKER_CONFIG = Symbol('WORKER_CONFIG');
export const WORKER_OBJECT_STORAGE = Symbol('WORKER_OBJECT_STORAGE');
export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');
/**
 * The MQTT vitals ingestion bridge, or undefined when MQTT is not configured.
 * Injected as @Optional() so the worker starts without a broker in CI/dev.
 */
export const MQTT_BRIDGE = Symbol('MQTT_BRIDGE');
/**
 * The Redis chat event publisher, or undefined when SMARTCURA_REDIS_URL is not
 * set. Injected as @Optional() so the worker starts without Redis in CI/dev.
 */
export const CHAT_PUBLISHER = Symbol('CHAT_PUBLISHER');
