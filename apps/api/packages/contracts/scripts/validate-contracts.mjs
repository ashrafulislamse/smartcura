import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const openapiPath = path.join(root, 'openapi', 'openapi.json');
const asyncapiPath = path.join(root, 'asyncapi', 'asyncapi.json');
const openapi = JSON.parse(fs.readFileSync(openapiPath, 'utf8'));
const asyncapi = JSON.parse(fs.readFileSync(asyncapiPath, 'utf8'));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function localRef(document, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return undefined;
  return ref.slice(2).split('/').reduce((value, token) => {
    const key = token.replaceAll('~1', '/').replaceAll('~0', '~');
    return value?.[key];
  }, document);
}

function walk(value, visit, location = '#') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visit, `${location}/${index}`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  visit(value, location);
  Object.entries(value).forEach(([key, child]) => walk(child, visit, `${location}/${key}`));
}

function validateLocalRefs(document, name) {
  walk(document, (value, location) => {
    if ('$ref' in value) {
      check(value.$ref.startsWith('#/'), `${name} external ref is not allowed at ${location}`);
      check(localRef(document, value.$ref) !== undefined, `${name} unresolved ref ${value.$ref} at ${location}`);
    }
  });
}

function operationAt(document, route, method) {
  return document.paths?.[route]?.[method];
}

check(openapi.openapi === '3.1.0', 'OpenAPI version must be 3.1.0');
check(openapi.jsonSchemaDialect === 'https://json-schema.org/draft/2020-12/schema', 'OpenAPI JSON Schema dialect must be 2020-12');
check(openapi.servers?.[0]?.url.endsWith('/api/v1'), 'OpenAPI server base must end with /api/v1');
check(openapi.components?.securitySchemes?.firebaseBearer?.type === 'http', 'firebaseBearer security scheme is missing');
check(openapi.components?.securitySchemes?.smartCuraSessionCookie?.in === 'cookie', 'SmartCura session cookie scheme is missing');

const expectedRoutes = [
  '/health',
  '/ready',
  '/sessions',
  '/sessions/current',
  '/sessions/refresh',
  '/sessions/step-up',
  '/sessions/current/active-role',
  '/profiles/me',
];
expectedRoutes.forEach((route) => check(openapi.paths?.[route], `OpenAPI route missing: ${route}`));

const operationIds = [];
for (const [route, pathItem] of Object.entries(openapi.paths ?? {})) {
  check(route.startsWith('/'), `OpenAPI route must be relative to /api/v1: ${route}`);
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = pathItem[method];
    if (!operation) continue;
    check(typeof operation.operationId === 'string', `operationId missing for ${method.toUpperCase()} ${route}`);
    operationIds.push(operation.operationId);
  }
}
check(new Set(operationIds).size === operationIds.length, 'OpenAPI operationId values must be unique');

const createSecurity = operationAt(openapi, '/sessions', 'post')?.security?.[0];
check(createSecurity && Object.keys(createSecurity).length === 1 && 'firebaseBearer' in createSecurity, 'Session bootstrap must use only firebaseBearer');
for (const route of ['/sessions/refresh', '/sessions/step-up']) {
  const security = operationAt(openapi, route, 'post')?.security?.[0];
  check(security && 'firebaseBearer' in security && 'smartCuraSessionCookie' in security, `${route} must require Firebase and app session`);
}
check(!JSON.stringify(openapi.components.schemas).includes('firebase_uid'), 'Firebase UID must not leak into generated business schemas');
check(!JSON.stringify(openapi.components.schemas).includes('session_token'), 'Opaque session token must be cookie-only');
check(openapi.components.schemas.Money?.properties?.currency?.const === 'MYR', 'Money must use MYR');
check(openapi.components.schemas.Money?.properties?.amount_sen?.type === 'integer', 'Money must use integer sen');
check(openapi.components.schemas.ProblemDetails?.required?.includes('correlation_id'), 'Problem Details must require correlation_id');
check(openapi.components.schemas.PageInfo, 'Cursor PageInfo schema is missing');
validateLocalRefs(openapi, 'OpenAPI');

check(asyncapi.asyncapi === '3.0.0', 'AsyncAPI version must be 3.0.0');
const expectedTopics = {
  mqttVitals: 'smartcura/v1/devices/{deviceId}/vitals',
  mqttStatus: 'smartcura/v1/devices/{deviceId}/status',
  mqttCommands: 'smartcura/v1/devices/{deviceId}/commands',
  mqttCommandAcks: 'smartcura/v1/devices/{deviceId}/command-acks',
  mqttOta: 'smartcura/v1/devices/{deviceId}/ota',
};
for (const [channel, address] of Object.entries(expectedTopics)) {
  check(asyncapi.channels?.[channel]?.address === address, `AsyncAPI topic mismatch: ${channel}`);
  check(asyncapi.channels?.[channel]?.['x-qos'] === 1, `${channel} must use QoS 1`);
}
check(asyncapi.channels?.mqttStatus?.['x-retain'] === true, 'MQTT status must be retained');
for (const channel of ['mqttVitals', 'mqttCommands', 'mqttCommandAcks', 'mqttOta']) {
  check(asyncapi.channels?.[channel]?.['x-retain'] === false, `${channel} must not be retained`);
}
check(asyncapi.channels?.socketioApp?.address === '/app', 'Socket.IO /app namespace is missing');
check(asyncapi.channels?.postgresOutboxEvents?.servers?.[0]?.$ref === '#/servers/postgresOutbox', 'Outbox must use the private PostgreSQL worker topology');
check(asyncapi.servers?.postgresOutbox?.protocol === 'postgresql', 'Outbox server must be PostgreSQL, not a pretend public broker');

const vitals = asyncapi.components?.schemas?.DeviceVitalsPacket;
check(vitals?.required?.includes('boot_id') && vitals?.required?.includes('sequence_no'), 'Device vitals must carry boot/sequence dedupe fields');
check(!('patient_id' in (vitals?.properties ?? {})), 'Device vitals payload must never carry patient_id');
check(vitals?.properties?.metrics?.['x-unique-by'] === 'metric', 'Device vitals must require one sample per metric and sequence');
check(vitals?.properties?.metrics?.uniqueItems === true, 'Device vitals must reject duplicate sample objects');
check(asyncapi.components?.schemas?.VitalMetric?.description?.toLowerCase().includes('scalar'), 'VitalMetric must explicitly exclude ECG waveform samples');
const command = asyncapi.components?.schemas?.DeviceCommandPacket;
const ack = asyncapi.components?.schemas?.DeviceCommandAckPacket;
check(command?.required?.includes('command_id'), 'Device command must require command_id');
check(ack?.required?.includes('command_id'), 'Device command ack must echo command_id');

const eventMetadata = asyncapi.components?.schemas?.EventMetadata;
for (const field of ['event_id', 'event_type', 'event_version', 'aggregate_id', 'aggregate_version', 'organization_id', 'correlation_id', 'partition_key']) {
  check(eventMetadata?.required?.includes(field), `Event metadata must require ${field}`);
}
for (const [name, message] of Object.entries(asyncapi.components?.messages ?? {})) {
  if (name.startsWith('Device')) continue;
  check(message.name?.endsWith('.v1'), `Async message ${name} must have a .v1 name`);
}
for (const [name, operation] of Object.entries(asyncapi.operations ?? {})) {
  check(['send', 'receive'].includes(operation.action), `Async operation ${name} has invalid action`);
  check(operation.channel?.$ref, `Async operation ${name} must reference a channel`);
}
validateLocalRefs(asyncapi, 'AsyncAPI');

if (failures.length > 0) {
  console.error(`Contract validation failed with ${failures.length} issue(s):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`OpenAPI valid: ${operationIds.length} operations, ${Object.keys(openapi.components.schemas).length} schemas`);
console.log(`AsyncAPI valid: ${Object.keys(asyncapi.operations).length} operations, ${Object.keys(asyncapi.channels).length} channels, ${Object.keys(asyncapi.components.schemas).length} schemas`);
