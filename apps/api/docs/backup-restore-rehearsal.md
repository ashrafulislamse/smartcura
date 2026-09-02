# PostgreSQL and Cloudflare R2 backup/restore rehearsal

> **UNEXECUTED — Not yet executed - blocked on Docker/VPS.** Docker is not installed on this workstation, no VPS/independent backup destination has been selected here, and no live R2 credentials were used. This document is a rehearsal procedure, not proof that a backup exists or a restore works.

## 1. Purpose and acceptance criteria

The rehearsal must prove that authoritative PostgreSQL metadata and required private R2 bytes can be recovered together into an isolated environment. R2 durability/versioning is not an independent backup. A pass requires all of the following observed evidence:

- a PostgreSQL custom-format dump and an object export complete without error;
- a PostgreSQL-linked object manifest records opaque key, bucket/provider, byte size, declared/verified SHA-256, state, and timestamps;
- backup artefacts are encrypted before transfer to a separately credentialed provider/failure domain;
- recorded ciphertext digests match after off-site retrieval;
- PostgreSQL restores into a new empty database and migrations/readiness metadata is present;
- objects restore into an alternate private bucket/prefix, never over the source;
- database manifest, downloaded-byte SHA-256, counts, and sizes reconcile;
- representative authorized object access works and unrelated access remains denied;
- constraints/triggers and `npm run check` remain green;
- RPO/RTO are reported from timestamps actually observed, or marked unmeasured.

## 2. Prerequisites

Use a Docker-capable staging/VPS host with enough free space for the database dump, all required object bytes, encryption overhead, and a second restore. Required operator tools: Docker Compose, AWS CLI v2 (for R2's S3-compatible API), an approved authenticated encryption tool such as `age`, and a SHA-256 utility. Use separate least-privilege credentials for:

1. source PostgreSQL;
2. source R2 read/list;
3. alternate restore bucket write/read/list;
4. independent off-site backup destination;
5. encryption recipient/key custody.

Cloudflare's current AWS CLI example uses region `auto` and endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Credentials must come from a secret manager/profile, never command arguments or evidence files.

Example operator variables (placeholders only):

```powershell
$RunId = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$Evidence = "backup-rehearsal-$RunId"
$R2Endpoint = 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com'
$R2Bucket = '<SOURCE_PRIVATE_BUCKET>'
$RestoreBucket = '<ALTERNATE_PRIVATE_RESTORE_BUCKET>'
$AgeRecipient = 'age1<BACKUP_PUBLIC_RECIPIENT>'
New-Item -ItemType Directory -Force $Evidence, "$Evidence\r2-objects" | Out-Null
```

Never put secret values in these variables in a transcript.

## 3. Quiescence and starting evidence

Choose and record either a short write freeze or an online logical-backup consistency model. For the FYP rehearsal, prefer a maintenance window: stop new traffic, stop API, allow the worker to drain, then stop the worker. Use only real npm scripts for application processes as documented in `docs/operational-runbook.md`.

On a Docker host, confirm database health and apply the current schema before a disposable rehearsal fixture (platform operations plus real scripts):

```powershell
docker compose up -d postgres
docker compose ps
npm run db:migrate
npm run db:probe
```

Record UTC start, build version, database version, migration journal count, table/trigger/constraint counts, source R2 object count/bytes, free disk, and the chosen consistency boundary. Do not export clinical row values into the report.

## 4. Capture PostgreSQL and the database-linked object manifest

Create the custom-format dump inside the container, then copy it out. This avoids PowerShell binary-redirection corruption:

```powershell
docker compose exec postgres pg_dump -U smartcura_dev -d smartcura_dev --format=custom --no-owner --no-privileges --file=/tmp/smartcura.dump
docker compose cp postgres:/tmp/smartcura.dump "$Evidence\smartcura.dump"
docker compose exec postgres rm -f /tmp/smartcura.dump
```

Export an opaque manifest from PostgreSQL. It is sensitive operational metadata and must be encrypted with the backup:

```powershell
docker compose exec -T postgres psql -U smartcura_dev -d smartcura_dev --csv -c "SELECT object_id, storage_provider, bucket, object_key, byte_size, declared_sha256, verified_sha256, upload_status, scan_state, downloadable, created_at, finalized_at, deleted_at FROM stored_objects ORDER BY object_id" | Set-Content -Encoding utf8 "$Evidence\stored-objects.csv"
```

Also record structural evidence without table data:

```powershell
docker compose exec -T postgres psql -U smartcura_dev -d smartcura_dev --csv -c "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public') AS public_tables, (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal) AS non_internal_triggers, (SELECT count(*) FROM information_schema.table_constraints WHERE constraint_schema='public') AS constraints, (SELECT count(*) FROM drizzle.__drizzle_migrations) AS migration_rows" | Set-Content -Encoding utf8 "$Evidence\source-structure.csv"
```

If the migration schema/table name differs in the deployed build, discover it read-only and record the corrected query; do not guess a successful count.

## 5. Export R2 objects and independent manifests

Configure an AWS CLI profile interactively or through the deployment secret mechanism; do not save keys in the repository:

```powershell
aws configure --profile smartcura-r2-source
```

Use region `auto`. List source metadata and download all current objects:

```powershell
aws s3api list-objects-v2 --profile smartcura-r2-source --endpoint-url $R2Endpoint --bucket $R2Bucket --output json > "$Evidence\r2-api-manifest.json"
aws s3 sync "s3://$R2Bucket" "$Evidence\r2-objects" --profile smartcura-r2-source --endpoint-url $R2Endpoint --no-progress
```

Generate a byte-level SHA-256 manifest locally. R2 ETags are not a substitute for SHA-256, especially for multipart objects:

```powershell
Get-ChildItem "$Evidence\r2-objects" -File -Recurse | ForEach-Object {
  [pscustomobject]@{
    relative_path = $_.FullName.Substring((Resolve-Path "$Evidence\r2-objects").Path.Length + 1).Replace('\','/')
    bytes = $_.Length
    sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
} | Sort-Object relative_path | ConvertTo-Json -Depth 3 | Set-Content -Encoding utf8 "$Evidence\r2-sha256-manifest.json"
```

Reconcile before encryption: every non-deleted database object expected to exist must have a downloaded key; byte size must match; every non-null `verified_sha256` must match the downloaded byte hash. Quarantined/private objects remain private but still require a policy decision about backup. Record exclusions explicitly; silent exclusion is a failure.

## 6. Integrity, encryption, and off-site transfer

Create a plaintext file inventory and digest, then encrypt the complete bundle to the approved backup public recipient:

```powershell
Get-ChildItem $Evidence -File -Recurse | ForEach-Object {
  "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring((Resolve-Path $Evidence).Path.Length + 1)
} | Set-Content -Encoding utf8 "$Evidence\plaintext-sha256.txt"

tar -cf "$Evidence.tar" $Evidence
age -r $AgeRecipient -o "$Evidence.tar.age" "$Evidence.tar"
Get-FileHash "$Evidence.tar.age" -Algorithm SHA256 | Format-List | Out-File "$Evidence.tar.age.sha256.txt"
```

Transfer only the ciphertext and ciphertext digest to the selected independent destination with its separately credentialed client. The vendor/region is intentionally a placeholder until `WP-02D`; do not call the local disk, VPS snapshot, or source R2 account “off-site backup.” After transfer, retrieve the ciphertext to a different path and verify its SHA-256 before decrypting. Destroy plaintext staging files according to the approved secure-cleanup procedure only after restore evidence is complete.

## 7. Restore PostgreSQL into an isolated database

Never restore over the source first. Create a separate database in the staging PostgreSQL instance:

```powershell
docker compose exec postgres createdb -U smartcura_dev smartcura_restore_$RunId
docker compose cp "$Evidence\smartcura.dump" postgres:/tmp/smartcura-restore.dump
docker compose exec postgres pg_restore -U smartcura_dev -d smartcura_restore_$RunId --no-owner --no-privileges --exit-on-error /tmp/smartcura-restore.dump
docker compose exec postgres rm -f /tmp/smartcura-restore.dump
```

Point a temporary, isolated API/worker environment at the restored database only after validating table, column, index, constraint, trigger, function, enum, generated-column, migration-journal, permission, and seed counts against source evidence. A table-count match alone is insufficient: a restore missing append-only or balance constraints can look healthy while accepting corruption.

Run the repository checks against the candidate code:

```powershell
npm run check
```

Then start the temporary worker and API with the existing scripts, using the restore `DATABASE_URL`, and verify `/health` and `/ready`. Record actual responses. Do not change the main environment's database URL.

## 8. Restore R2 bytes into an alternate private bucket

Configure a separately scoped restore profile. Do **not** use a local `aws s3 sync` round trip for the upload: downloading to a filesystem loses R2 user metadata, including `x-amz-meta-sha256`, and a restored byte without the application-required checksum metadata is not a valid restore.

Upload each PostgreSQL-linked object into a bucket/prefix that cannot affect source objects, explicitly restoring its content type and SHA-256 metadata from the reconciled database manifest:

```powershell
aws configure --profile smartcura-r2-restore
$ObjectRoot = (Resolve-Path "$Evidence\r2-objects").Path
Import-Csv "$Evidence\stored-objects.csv" | Where-Object { $_.upload_status -ne 'deleted' } | ForEach-Object {
  $LocalPath = Join-Path $ObjectRoot ($_.object_key.Replace('/', [IO.Path]::DirectorySeparatorChar))
  if (-not (Test-Path -LiteralPath $LocalPath -PathType Leaf)) { throw "Manifest object is absent from the downloaded backup" }
  $ActualBytes = (Get-Item -LiteralPath $LocalPath).Length
  $ActualSha256 = (Get-FileHash -LiteralPath $LocalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $ExpectedSha256 = if ($_.verified_sha256) { $_.verified_sha256 } else { $_.declared_sha256 }
  if ($ActualBytes -ne [int64]$_.byte_size -or $ActualSha256 -ne $ExpectedSha256) { throw "Manifest reconciliation failed before restore upload" }
  aws s3 cp $LocalPath "s3://$RestoreBucket/$RunId/$($_.object_key)" `
    --profile smartcura-r2-restore --endpoint-url $R2Endpoint --no-progress `
    --content-type $_.media_type --metadata "sha256=$ExpectedSha256"
  if ($LASTEXITCODE -ne 0) { throw "R2 restore upload failed" }
}
aws s3api list-objects-v2 --profile smartcura-r2-restore --endpoint-url $R2Endpoint --bucket $RestoreBucket --prefix $RunId --output json > "$Evidence\r2-restored-api-manifest.json"
```

For every restored key, run `aws s3api head-object` and compare `ContentLength`, `ContentType`, and `Metadata.sha256` with `stored-objects.csv`; save a PHI-free pass/fail reconciliation report. Then download the restored prefix to a second local directory and regenerate SHA-256 hashes; compare by relative key, byte count, and digest with `r2-sha256-manifest.json`. Do not accept list count or ETag alone.

To perform an application-level smoke test, either restore object keys into a fully isolated bucket whose name is mapped in an isolated copy of PostgreSQL, or use a reviewed remapping transaction in the isolated restore database. Verify one clean authorized object can be retrieved, an unrelated actor receives concealed denial, and pending/quarantined/infected objects are not downloadable. Never rewrite source metadata for a rehearsal.

## 9. Evidence record and result

Complete this table only from observed outputs:

| Item | Result |
|---|---|
| Run ID / UTC start-end | **UNMEASURED — rehearsal not run** |
| Source build/schema | **UNMEASURED** |
| PostgreSQL dump bytes/SHA-256 | **UNMEASURED** |
| Database restore duration | **UNMEASURED** |
| Structural parity | **UNMEASURED** |
| Source/restored object count and bytes | **UNMEASURED** |
| Object SHA-256 reconciliation | **UNMEASURED** |
| Off-site retrieval digest | **UNMEASURED** |
| Authorized/denied object smoke | **UNMEASURED** |
| Observed RPO/RTO | **UNMEASURED** |
| Overall rehearsal | **NOT EXECUTED — BLOCKED ON DOCKER/VPS** |

A pass does not establish point-in-time recovery unless WAL archiving and PITR are separately configured and rehearsed. Record every excluded object, failed check, manual intervention, tool/version, and follow-up owner.
