import fs from 'node:fs';

const file = 'apps/api/docker-compose.prod.yaml';
const source = fs.readFileSync(file, 'utf8');
const required = ['postgres', 'redis', 'clamav', 'mosquitto', 'livekit', 'api', 'migrate', 'worker'];

if (!/^name:\s*\S+/m.test(source)) {
  throw new Error(`${file} must declare a top-level Compose name`);
}

const services = source.match(/^  ([a-z][a-z0-9-]*):\s*$/gm)?.map((line) => line.trim().slice(0, -1)) ?? [];
const missing = required.filter((service) => !services.includes(service));
if (missing.length > 0) {
  throw new Error(`${file} is missing services: ${missing.join(', ')}`);
}

for (const service of ['api', 'migrate', 'worker']) {
  const block = source.match(new RegExp(`^  ${service}:[\\s\\S]*?(?=^  [a-z]|^volumes:|\\z)`, 'm'))?.[0] ?? '';
  if (!block.includes('context: ../..') || !block.includes('dockerfile: apps/api/Dockerfile')) {
    throw new Error(`${service} must use the repository-root Docker build context`);
  }
}

if (!source.includes('condition: service_completed_successfully')) {
  throw new Error('api and worker must wait for the migration job');
}

console.log(`Compose validation passed: ${file} (${services.length} services)`);
