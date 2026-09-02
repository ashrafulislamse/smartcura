#!/usr/bin/env node
/**
 * Static portal integrity audit. This deliberately does not claim that a page renders:
 * browser verification belongs in the portal smoke suite. It catches route/menu drift and
 * accidental reintroduction of fixture data into pages that have a backend contract.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('../apps/web-portal/', import.meta.url).pathname.replace(/^\/+([A-Z]:)/, '$1');
const appRoot = join(root, 'src', 'app');
const menuPath = join(root, 'src', 'lib', 'rbac', 'menu-config.ts');
const rbacPath = join(root, 'src', 'lib', 'rbac', 'index.ts');
const allowlistedMockPages = new Set([
  'src/app/(authenticated)/users/patients/page.tsx',
  'src/app/(authenticated)/users/patients/[id]/page.tsx',
  'src/app/(authenticated)/users/verification/page.tsx',
  'src/app/(authenticated)/settings/audit-logs/page.tsx',
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(tsx|ts)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function pageRoute(file) {
  const rel = relative(appRoot, file).split(sep).join('/');
  if (!rel.endsWith('/page.tsx') && !rel.endsWith('/page.ts')) return null;
  let route = rel.replace(/\/page\.tsx?$/, '').replace(/^\([^/]+\)\//, '');
  if (route === 'page') route = '';
  return `/${route.replace(/\[([^/]+)\]/g, ':$1')}`;
}

const files = await walk(appRoot);
const pages = files.map(pageRoute).filter(Boolean).sort();
const pageRecords = [];
for (const file of files) {
  const route = pageRoute(file);
  if (!route) continue;
  const text = await readFile(file, 'utf8');
  const rel = relative(root, file).split(sep).join('/');
  pageRecords.push({
    route,
    file: rel,
    usesApi: /@\/lib\/api\//.test(text),
    usesMockData: /@\/lib\/mock-data/.test(text),
    hasResourceState: /ResourceState|useApiResource/.test(text),
    hasMutation: /method:\s*['\"](?:POST|PUT|PATCH|DELETE)['\"]|\b(create|update|delete|submit|save|approve|reject|cancel|dispatch)\b/i.test(text),
  });
}

const [menu, rbac] = await Promise.all([
  readFile(menuPath, 'utf8'),
  readFile(rbacPath, 'utf8'),
]);
const configuredRoutes = [...new Set([...menu.matchAll(/['\"](\/[^'\"]+)['\"]/g), ...rbac.matchAll(/['\"](\/[^'\"]+)['\"]/g)].map(match => match[1]))].sort();
const pageRoutes = new Set(pages);
const missingMenuRoutes = configuredRoutes.filter(route => !pageRoutes.has(route) && !route.includes(':'));
const unexpectedMocks = pageRecords.filter(page => page.usesMockData && !allowlistedMockPages.has(page.file));
const deadLinks = pageRecords.filter(page => page.file).length;

const report = {
  generated_at: new Date().toISOString(),
  page_count: pages.length,
  pages: pageRecords,
  configured_route_count: configuredRoutes.length,
  missing_menu_routes: missingMenuRoutes,
  allowlisted_mock_pages: [...allowlistedMockPages],
  unexpected_mock_pages: unexpectedMocks,
  summary: {
    api_pages: pageRecords.filter(page => page.usesApi).length,
    mock_pages: pageRecords.filter(page => page.usesMockData).length,
    resource_state_pages: pageRecords.filter(page => page.hasResourceState).length,
    mutation_pages: pageRecords.filter(page => page.hasMutation).length,
  },
};

console.log(JSON.stringify(report, null, 2));
// Known legacy menu entries are reported for cleanup, but do not block the build.
// Reintroducing a fixture-backed page outside the explicit backend-blocked allowlist does.
if (unexpectedMocks.length) process.exitCode = 1;
