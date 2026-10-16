# P2 learning guide: persistence, retries, containers, local versions

## Scope and approval checkpoint

The user approved P2.1-P2.4 together, following the P1 workflow. This authorizes
local demo database/container/version work, not production data changes or P3.
Docker Desktop is running. Native and Compose verification have both passed;
measured results and historical troubleshooting are recorded in PROGRESS.md.

## P2.1: PostgreSQL orders and payments

### Concept

SQL describes data queries and changes. A table holds typed rows. A primary key
uniquely identifies a row; a foreign key requires a related row to exist. A unique
constraint prevents duplicates even under concurrency. CHECK constraints reject
invalid values. timestamptz stores instants; serialize them with UTC offsets.

A transaction commits its writes together, or rolls them back together on failure.
It does not make an HTTP request and a remote transaction magically atomic.
Migrations are ordered, versioned schema changes. Editing an already-applied
migration is unsafe; add a new one. Parameterized SQL keeps values separate from
SQL syntax. psycopg is the Python PostgreSQL driver; no ORM is needed for two tables.

### Architecture/data flow

Checkout -> payment HTTP boundary -> payment store -> one PostgreSQL transaction
inserts demo_orders and demo_payments -> commit -> HTTP response. Payment owns
both demo tables and their transaction; checkout never writes the database.
This is a deliberately shared demo transaction boundary, not independent order
and payment databases. Future distributed workflows need stronger reconciliation.

The memory adapter remains an explicit P1 mode for fast tests and compatibility.
STORAGE_MODE=postgres never falls back to it. Compose selects PostgreSQL explicitly.
No real money moves in either mode.

### File plan, implementation, walkthrough

- database/migrations/001_demo_payments.sql: orders use UUID PK, integer amount
  bounds and allowed currency. Payments reference orders, with unique order/key,
  succeeded status and database-generated creation timestamps. One simulated
  payment per order is a business invariant, independent of the idempotency key.
- scripts/migrate.py: migrate(dsn) opens a bounded connection, takes a transaction
  advisory lock, verifies migration filenames/checksums, applies pending SQL and
  records it. All pending changes commit together; exceptions roll back. It is
  the sole migration owner; app startup never auto-creates/synchronizes tables.
- payment store.py: PostgresStore.save(request,key) uses parameterized SQL inside
  a connection transaction context. A successful return exits the context only
  after commit. Errors roll back order/payment writes. Connections are short-lived
  for this small demo; connection/statement/lock waiting is bounded.
- MemoryStore is a locked dictionary adapter, clearly non-durable, not proof of
  persistence. create_app supports an explicit injected store for unit tests.
- main.py awaits asyncio.to_thread for synchronous database work so the ASGI event
  loop remains responsive. /health remains process health; /ready checks tables
  and storage and returns 503 when database/schema access fails.
- requirements files pin the psycopg driver and transitive environment.

### Run/test

With a local database URL in the environment and the Python dependencies installed:

```powershell
.\.venv\Scripts\python.exe scripts/migrate.py
.\.venv\Scripts\python.exe scripts/migrate.py
$env:STORAGE_MODE = 'postgres'
# Start payment with the same Uvicorn command documented in README.
```

First migration run applies pending files; the second reports already current.
Positive: create payment, restart service/database, and replay to observe the same
stored payment. Negative: missing DB configuration, invalid FK/amount constraints,
and transaction failure must not produce a partially committed order/payment pair.
Actual real-PostgreSQL evidence will be distinguished from memory tests in PROGRESS.

### Debug and security

Do not print DATABASE_URL, database passwords, or rendered Compose secrets. Missing
tables usually mean the explicit migration step was skipped. A checksum mismatch
means an applied file changed: restore it and author a new migration. Do not drop
tables or delete volumes to make a test pass. Local demo roles are not a production
privilege model; credentials belong in ignored environment configuration.

### Understanding check

1. How does a foreign key differ from a unique constraint?
2. Why must both inserts occur in one transaction?
3. Why is memory-mode success not persistence evidence?

Exercise: attempt an invalid amount in a disposable test transaction and confirm
the database rejects it; do not modify real rows or migration history.

### Commit summary

P2.1 introduces an explicit PostgreSQL transaction boundary and migration owner.

## P2.2: idempotency and safe bounded retries

### Concept

Idempotency means repeating the same operation identifier does not repeat the
effect. A timeout is an unknown outcome: payment might have committed after the
caller stopped waiting. Retrying without durable deduplication can duplicate it.
The UUID Idempotency-Key identifies an attempt; order_id identifies the business
order. A request ID is just a correlation identifier, not an idempotency key.

### Architecture/data flow

Checkout validates optional Idempotency-Key, defaults missing key to order_id for
P1 compatibility, forwards it unchanged on each attempt. Payment locks key and
order, checks prior result/payload, and either returns it, conflicts, or commits
one new result. Same key/different payload: 409. Different key/already-paid order: 409. No second order/payment is inserted on either conflict.

### File plan, implementation, walkthrough

PostgresStore.save takes transaction-scoped advisory locks on key and order in a
consistent order, then checks stored data. Concurrent requests sharing either
identifier serialize; hash collisions only serialize extra work, not skip checks.
Database unique constraints remain the final protection. MemoryStore emulates the
contract only for isolated unit tests. No network call happens while a database
transaction lock is held: payment's simulated faults occur before saving.

Checkout payment-client.ts separates pay (bounded retry loop) from payOnce (one
HTTP call). It retries network/timeouts and temporary 502/503/504 status failures,
at most twice, with a fixed 50 ms wait and the same body/key. It never retries 409,
invalid payloads, malformed JSON or mismatched response fields. Each attempt has
the configured deadline, so maximum dependency waiting is approximately
attempts * PAYMENT_TIMEOUT_MS + 50 ms (plus small scheduling/processing overhead).
PAYMENT_MAX_ATTEMPTS is 1 or 2; default 2. No unbounded backoff or retry storm.

### Approval checkpoint

Covered by approved P2 local demo work. This is still a simulated payment service,
not an exactly-once guarantee for a real external gateway. A real gateway needs
its own idempotency/reconciliation boundary and durable outcome handling.

### Run/test

```powershell
$key = [guid]::NewGuid().ToString()
$order = [guid]::NewGuid().ToString()
$body = @{ order_id=$order; amount_minor=12500; currency='INR' } | ConvertTo-Json
$headers = @{ 'Idempotency-Key'=$key }
Invoke-RestMethod http://127.0.0.1:3001/checkout -Method Post -ContentType 'application/json' -Headers $headers -Body $body
# Repeat exactly: same payment_id. Change amount with same key: HTTP 409.
npm test
.\.venv\Scripts\python.exe -m pytest services/payment-service -q
```

Positive: repeated/concurrent requests return the same payment UUID, one stored
order and one payment. Negative: conflicting payload/key, different key for paid
order, and malformed key are rejected. A transient HTTP test double verifies two
attempts carry the same key; it is not a real database/gateway. Real database
concurrency/restart/uncertain-outcome checks belong to the P2 verification runner.

### Debug

409 requires a fresh order/operation or the original payload, not blind retries.
After 504, reuse the same key to reconcile; do not invent a replacement key.
If a local fault is active, even replays may fail before storage lookup; restore
healthy service and replay the original key. Log correlation helps trace attempts.

### Understanding check

1. Why is a timeout not proof of rollback?
2. Why enforce unique order_id in addition to unique key?
3. Why must retries preserve both body and key?

Exercise: submit the same key twice, then change only amount; compare IDs/statuses
and inspect row counts using the documented read-only verification query.

Read-only counts for the running Compose demo (no password in the command):

```powershell
docker compose --env-file .env -f infrastructure/compose.yaml exec db psql -U sentinel -d sentinel -c 'SELECT (SELECT count(*) FROM demo_orders) AS orders, (SELECT count(*) FROM demo_payments) AS payments;'
```

### Commit summary

P2.2 adds durable deduplication, conflicts and a bounded retry policy.

## P2.3: local containers and persistent volume

### Concept

A Dockerfile is a build recipe. An image packages filesystem/runtime configuration;
a container is a running instance. A container's writable layer is disposable.
A named volume stores PostgreSQL data independently of that layer. A network lets
services address one another by service name. Host ports expose selected listeners.
Inside checkout, payment means the payment container, not the host's loopback.

Compose describes services, build contexts, environment, networks, volume and
health ordering. Starting a container is not proof it is ready. depends_on uses
database health and a successfully completed one-shot migration before payment,
then payment readiness before checkout. No Kubernetes, Redis or AI is introduced.

### Architecture/data flow

Host loopback 3001 -> checkout container -> payment:3002 -> db:5432 -> named volume.
The database also publishes host loopback 55432 for operator migration/verification.
The migration container runs the same single migration owner once, then exits 0.
/health remains liveness; payment /ready checks the actual store/tables.

### File plan, implementation, walkthrough

- checkout Dockerfile: build stage installs the locked workspace, compiles TS,
  removes development dependencies; final stage contains runtime dependencies and
  compiled service. USER node avoids running the app as root. CONTAINER_MODE=1
  enables binding inside the container and the fixed payment service hostname.
- payment Dockerfile: installs pinned Python requirements, copies payment code,
  SQL and migration entry point. PYTHONPATH makes config importable for the one-shot
  migration. A numeric non-root user serves HTTP. Build args become safe version/
  source/commit metadata and image labels, not credentials.
- infrastructure/compose.yaml: named local project, database/migrate/payment/
  checkout, health checks and dependency conditions, loopback-only published ports,
  database volume, reduced app-container privileges and read-only app filesystems.
  Duplicate payment build definitions use the same recipe/arguments/image so the
  migration service and runtime share the same schema source.
- .dockerignore: excludes Git, installed dependencies, credentials, local tools,
  generated test clusters and reports from the build context.
- scripts/init-local.py: creates ignored .env once with random local credentials.
  Existing files are preserved. It never prints their contents. .env.example is
  fake documentation only. CLI helpers read allowlisted .env keys; service processes
  themselves still receive configuration through their startup environment.
- scripts/setup-postgres.ps1: optional Windows-only portable server for independent
  real PostgreSQL tests. No system service or PATH installation. Its pinned hash
  matches the measured official EDB HTTPS archive, not a publisher-signed manifest.
- scripts/verify-p2.py: native and compose backends keep separate reports, so one
  cannot be mistaken for the other. Native owns its fresh cluster/processes and
  uses file-based pg_ctl output on Windows to avoid inherited-pipe hangs. Compose
  uses an isolated verifier project and retains its volume when removing test
  containers. Both refuse occupied ports. No destructive production operations.

### Approval checkpoint

Local P2 container work is authorized. The engine-backed Compose run passed on
2026-10-16, including actual builds, health, persistence and version rollback.
Inspect PROGRESS.md for the measured results and the earlier Docker blocker.

### Run/test

After Docker Desktop is running with Linux containers:

```powershell
.\.venv\Scripts\python.exe scripts/init-local.py
docker compose --env-file .env -f infrastructure/compose.yaml config --quiet
docker compose --env-file .env -f infrastructure/compose.yaml up -d --build --wait
docker compose --env-file .env -f infrastructure/compose.yaml ps
```

Expected: database/payment/checkout healthy; migrate exited 0. --quiet validates
configuration without printing rendered secrets. Use README's checkout command
with fresh UUIDs. Restart payment/database and repeat the same key: same payment.

```powershell
npm run verify:p2:compose
```

The verifier reserves its own project/volume, applies migrations, builds/starts
real containers, tests concurrency/restarts, and switches versions. Run only with
manual demo services stopped because host ports are fixed. Its down command does
not use -v; test data volume is retained. It does not touch sentinel-demo containers.

For the independent native path (requires the portable server):

```powershell
.\scripts\setup-postgres.ps1
npm run verify:p2
```

Positive: actual PostgreSQL data survives service and database restart. Negative:
bad constraints roll back, schema edits are detected using an altered fixture copy,
and occupied ports are refused. No actual migration source/history is edited for
the checksum test. Native mode is not evidence that container builds/health pass.

### Debug, alternatives, and security

Docker CLI absent: install/start Desktop. Daemon unavailable: wait for engine
readiness. Wrong mode: select Linux containers. Build errors and failed health
checks require inspecting the failing service, not deleting data. Never run down
-v or a volume prune as a troubleshooting shortcut. Host DATABASE_URL uses port
55432; containers use db:5432. Password rotation also needs a database role update:
changing .env alone does not change a previously initialized volume's password.

Native processes have simpler debugging; containers add repeatability and isolation
but require virtualization, image downloads and an engine. The demo database owner
is intentionally convenient; production would separate migration and runtime roles.
Both app services run as non-root. Image versions AND registry digests are pinned;
digest availability was checked against Docker Hub, not inferred from tag names.

### Understanding check

1. Why does container localhost not identify the payment container?
2. Why is a named volume different from the container's writable layer?
3. Why wait for migrations/readiness instead of merely starting processes?

Exercise: stop/start the demo without deleting its volume; replay an existing key
and compare payment_id. Explain why removing a volume would invalidate this test.

### Commit summary

P2.3 packages checkout/payment/PostgreSQL; acceptance requires an actual Compose run.

## P2.4: immutable local versions and deployment records

### Concept

A version names a defined artifact/configuration. A deployment is an attempt to run
that version at a time. A rollback selects a known prior artifact; it does not undo
database migrations automatically. Tags can move, so we bind records to a source
SHA256 and, for Compose, a Docker image ID. A Git commit is recorded only when the
source is committed; an explicitly allowed working tree is labeled unknown with
its exact content hash instead of falsely claiming the previous HEAD contains it.

### Architecture/data flow

CLI validates allowlisted version -> verifies/builds local image -> immutable version
registration -> PENDING deployment -> recreate only payment -> check /version plus
/ready -> ACTIVE record and supersede old verified deployment. Failures are FAILED;
an unverified process is never reported as successfully deployed. Checkout/database
are not rebuilt or replaced by a version switch. The database volume is retained.

### File plan, implementation, walkthrough

- payment versions.json: payment-v1 is normal; payment-v2-timeout is a fixed 3000 ms
  delay; payment-v3-error is a fixed 503. These are configuration versions of the
  same demo service, not three unrelated source releases. They demonstrate a
  deployment regression without hardcoding a future incident investigation result.
- config.py: named profiles override ad-hoc P1 fault settings. Metadata has bounded
  known formats. Unsupported versions are rejected. /version returns safe version,
  source checksum, commit marker, deployment UUID and fault mode, never credentials.
- 002_demo_deployments.sql: immutable version definitions and deployment attempts.
  Partial unique indexes permit one ACTIVE and one PENDING payment deployment.
  Timestamps use timestamptz. Applications/CLI use UTC conversion for reporting.
- deployment_registry.py: register_version rejects changed content/config/image ID
  under an old name. begin_deployment inserts PENDING. finish_deployment checks the
  runtime identity before atomically superseding the old ACTIVE record and activating
  the new one. A failed/mismatched readiness check cannot activate a deployment.
- local_support.py: reads only allowlisted local configuration keys, locates Docker,
  hashes normalized runtime source, and issues fixed local HTTP requests. It runs
  subprocess argument lists, not interpolated shell commands.
- switch-payment.py: default prints a plan. --apply targets only payment-service
  in the local demo/verifier project. Existing registered images are selected by
  immutable image ID and checked against metadata, even if a tag moved. Building
  new contents under a registered old name is rejected. Known good cached images
  support rollback. Successful default-demo switches atomically update only safe
  deployment selectors in ignored .env, preserving credentials. Test projects do
  not rewrite the operator's deployment selectors.
- verify-p2.py: real native/container modes test healthy -> timeout -> error ->
  healthy and check registry state. Native process verification is labeled native;
  it cannot prove Docker image behavior. Read the backend-specific report.

### Approval checkpoint

User authorized local sandbox version switching in P2. No arbitrary shell/action
endpoint is added, no public deployment API, and no production rollback is allowed.
CLI execution uses the local operator's permissions; future backend RBAC is P3/P8.

### Run/test

Start the local Compose demo first. From a clean committed checkout:

```powershell
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v1
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v1 --apply
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v2-timeout --apply
curl.exe http://127.0.0.1:3002/version
# A fresh checkout should return 504 under the default Compose deadline.
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v1 --apply
```

An explicit --allow-working-tree records an exact source hash and unknown commit
for local development. Prefer committed source for a reproducible demonstration.
Positive: metadata/version/time recorded, original image restores healthy checkout.
Negative: unknown version, changed source under old name, mismatched runtime identity,
or unavailable engine cannot be claimed successful. The automated runner covers
known failures and checks exactly one verified ACTIVE deployment.

### Debug, risks, and limitations

ACTIVE means last successfully verified runtime identity/readiness, not an infallible
live status monitor. Always compare current /version/readiness after external manual
changes or a failed switch; failed replacement may leave an unverified container.
The tool does not silently perform a second remediation. A PENDING record left by
a killed CLI requires operator reconciliation; do not delete audit rows blindly.
Cached images may be needed for rollback. Removing them can make an old version
unavailable; never rebuild different source under its old name to conceal that.

Faulty versions keep health/readiness green while checkout fails: those checks
prove process/storage readiness, not business correctness. Schema rollback is not
implemented; future migrations must remain compatible with supported app versions.

### Understanding check

1. How do version, Git commit, source hash and deployment ID differ?
2. Why is an ACTIVE readiness check compatible with a broken checkout?
3. Why must a failed identity check never become an ACTIVE record?

Exercise: plan a faulty version, apply it locally, inspect /version and checkout,
then restore payment-v1. Compare timestamps and retain the database records.

Read-only deployment history:

```powershell
docker compose --env-file .env -f infrastructure/compose.yaml exec db psql -U sentinel -d sentinel -c 'SELECT version, status, deployed_at, verified_at FROM demo_deployments ORDER BY deployed_at DESC;'
```

### Commit summary

P2.4 adds an allowlisted local version catalog and auditable verified switches.

## Final P2 learner checklist

Explain transaction boundaries, a timeout-after-commit timeline, key conflicts,
container networking/volumes, and source/image/deployment identities. Run the
documented commands yourself and complete each exercise. Software verification is
separate from student mastery; no learner completion is assumed. See PROGRESS.md
for measured native and Docker results. P3 requires a new explicit approval.

## Primary references

- [PostgreSQL Windows distributions](https://www.postgresql.org/download/windows/)
- [Psycopg transaction contexts](https://www.psycopg.org/psycopg3/docs/basic/transactions.html)
- [PostgreSQL INSERT and uniqueness conflicts](https://www.postgresql.org/docs/current/sql-insert.html)
- [Docker Desktop Windows prerequisites](https://docs.docker.com/desktop/setup/install/windows-install/)
- [Compose readiness/startup ordering](https://docs.docker.com/compose/how-tos/startup-order/)
