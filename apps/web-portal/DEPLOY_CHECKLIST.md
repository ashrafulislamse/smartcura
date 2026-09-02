# VPS Deployment Checklist

**Status:** Target checklist for `WP-02D` and later releases

## Before deployment

- [ ] A VPS provider/region/plan meeting 8 vCPU, 16 GiB RAM, at least 240 GiB SSD/NVMe, static IPv4 and at least 1 TiB transfer has been selected in `WP-02D`; current price/capacity and required UDP/TCP paths are rechecked before purchase
- [ ] Ubuntu LTS is patched; SSH uses keys and restricted source access
- [ ] DNS records exist for `admin`, `api`, `mqtt`, `video` and `monitor`; any optional R2 custom hostname has a separately reviewed access/cache policy
- [ ] Caddy, Compose and firewall configuration are reviewed
- [ ] Portal image is pinned to a commit SHA; no `latest`-only deployment
- [ ] `npm run type-check` passes
- [ ] `npm run build` passes without relying on runtime internet font downloads

## Configuration and security

- [ ] Public portal variables contain no secrets
- [ ] Firebase authorized domains match the admin hostname
- [ ] API CORS allows only approved origins
- [ ] Firebase Admin, OpenAI-compatible AI key and Cloudflare R2 credentials exist only in backend secrets
- [ ] The existing R2 bucket is private; backend credentials are least-privilege; CORS, lifecycle/versioning and usage alerts are reviewed
- [ ] PostgreSQL, Redis, worker, ML and monitoring storage are private
- [ ] Admin and monitoring consoles require VPN or strong restricted access
- [ ] Logs and metrics have passed PHI-redaction checks and do not expose object keys or signed URLs

## Release verification

- [ ] `/health` and `/ready` pass through the public API hostname
- [ ] Portal login, MFA, role selection, refresh and logout work
- [ ] Unauthorized role/object access is denied and audited
- [ ] Socket.IO reconnect and notification flow work
- [ ] File upload/download uses NestJS-authorized, short-lived R2 operations; clients never receive R2 credentials
- [ ] Previous portal image can be restored

## Recovery

- [ ] Provider snapshot schedule is active
- [ ] Client-side encrypted PostgreSQL backup is copied to the `WP-02D`-selected independent provider/region with separate credentials
- [ ] Required R2 objects and a PostgreSQL-linked manifest are exported in encrypted form to the independent destination
- [ ] R2 lifecycle/versioning is treated as operational recovery, not an independent backup of R2
- [ ] A restore rehearsal covers PostgreSQL metadata and object bytes and has been recorded

This replaces the obsolete Vercel checklist. Production deployment is defined by the authoritative backend technical specifications.
