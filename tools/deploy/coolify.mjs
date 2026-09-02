// Coolify deployment helper. Usage:
//   node tools/deploy/coolify.mjs list                              list resources
//   node tools/deploy/coolify.mjs deploy <uuid>                      trigger deploy
//   node tools/deploy/coolify.mjs status <uuid>                      show resource
//   node tools/deploy/coolify.mjs logs <uuid>                        tail deploy logs
//   node tools/deploy/coolify.mjs deployments <uuid>                 list deployments
import fs from 'fs';

const env = fs.readFileSync('.coolify-secrets.env', 'utf8');
const token = env.match(/COOLIFY_API_TOKEN=(.+)/)[1].trim();
const baseUrl = env.match(/COOLIFY_BASE_URL=(.+)/)[1].trim();
const headers = { Authorization: 'Bearer ' + token };

const [,, action, ...args] = process.argv;

async function api(path, options = {}) {
  const res = await fetch(baseUrl + path, { ...options, headers: { ...headers, ...options.headers } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

if (action === 'list') {
  const { status, data } = await api('/api/v1/applications');
  console.log('status:', status);
  if (Array.isArray(data)) {
    for (const app of data) {
      console.log(`${app.uuid}\t${app.name}\t${app.status ?? '?'}\t${app.git_repository ?? ''}:${app.git_branch ?? ''}`);
    }
  } else {
    console.log(JSON.stringify(data, null, 2).slice(0, 3000));
  }
} else if (action === 'status') {
  const [uuid] = args;
  const { status, data } = await api('/api/v1/applications/' + uuid);
  console.log('status:', status);
  console.log(JSON.stringify(data, null, 2).slice(0, 5000));
} else if (action === 'deploy') {
  const [uuid] = args;
  // Coolify v4 uses a top-level deploy endpoint; the v3-style
  // /api/v1/applications/{uuid}/deploy route returns 404 on v4.1.2.
  // `force=true` re-creates containers that the v4 deploy otherwise leaves
  // in place when the compose file did not change.
  const qs = 'uuid=' + encodeURIComponent(uuid) + '&force=true';
  const { status, data } = await api('/api/v1/deploy?' + qs, { method: 'POST' });
  console.log('deploy status:', status);
  console.log(JSON.stringify(data, null, 2).slice(0, 2000));
} else if (action === 'deployments') {
  // Coolify v4 has no working read endpoint for an application's
  // deployments: the top-level /api/v1/deployments?uuid=... returns []
  // after the first call, the v3 /api/v1/applications/{uuid}/deployments
  // returns 404, and the per-deployment /api/v1/deployments/{id} returns
  // 404 even for ids the list just returned. The deploy response itself
  // (above) is the most reliable place to read a deployment id from.
  const [uuid] = args;
  const { status, data } = await api('/api/v1/deployments?uuid=' + encodeURIComponent(uuid));
  console.log('status:', status);
  if (Array.isArray(data) && data.length > 0) {
    for (const d of data.slice(0, 5)) {
      console.log(`${d.id}\t${d.deployment_url ?? d.uuid ?? ''}\t${d.status ?? '?'}\t${d.created_at ?? ''}`);
    }
  } else {
    console.log('(no deployments returned; Coolify v4 does not surface them here)');
  }
} else if (action === 'logs') {
  const [uuid] = args;
  // TODO: the v3 /api/v1/deployments/{id} and the v4
  // /api/v1/applications/{uuid}/deployments/{id} paths both 404 on v4.1.2
  // even for ids the list endpoint just returned. The v4 way to read a
  // deployment's logs is not yet known — track it down before using `logs`.
  // First get latest deployment
  const { data: deps } = await api('/api/v1/applications/' + uuid + '/deployments');
  let depId;
  if (Array.isArray(deps) && deps.length > 0) {
    depId = deps[0].id ?? deps[0].uuid;
    console.log('latest deployment:', depId, deps[0].status ?? '');
  }
  if (depId) {
    // See TODO above. The v3 /api/v1/deployments/{id} path was the only
    // one that worked pre-v4, and it returns 404 on v4.1.2.
    const { status, data } = await api(`/api/v1/deployments/${depId}`);
    console.log('log status:', status);
    if (typeof data === 'string') {
      // Tail the last portion
      console.log(data.slice(-5000));
    } else if (data?.logs) {
      console.log(String(data.logs).slice(-5000));
    } else {
      console.log(JSON.stringify(data, null, 2).slice(0, 5000));
    }
  }
} else {
  console.log('Usage: node tools/deploy/coolify.mjs <list|status|deploy|deployments|logs> [uuid]');
}
