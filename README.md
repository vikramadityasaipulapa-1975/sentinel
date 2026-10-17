# Sentinel

Sentinel is a learning-first AI-assisted incident response and reliability project.
**P1 implementation is complete:** two local demo services, validated simulated
payments, bounded checkout calls, request IDs, safe JSON logs, deterministic faults,
and reproducible local tests/load checks. P2 adds PostgreSQL persistence,
idempotency/retries, container definitions, and local deployment version tooling.
See the progress log for separately measured native and Docker verification.
**P2 implementation is verified:** native PostgreSQL and Docker/Compose checks
passed, including restart persistence and container version switching/rollback.
AI, centralized telemetry and remediation remain future phases.

**P3.1:** the main Sentinel API now has a PostgreSQL-backed service registry,
explicit migrations, readiness checks and a reproducible local workflow. See the
[P3 learning guide](docs/P3-LEARNING-GUIDE.md) for the full walkthrough and hosted setup requirements.

**P3.2:** incidents now support creation, filtering, cursor pagination, detail,
validated status transitions and transactional event history. A rejected transition
does not change the incident or add an event.

**P3.3:** login, salted password hashing, 15-minute signed access tokens, live user
checks and backend role permissions protect the API. No default accounts exist.

**P3.5:** authenticated SSE replays durable incident/investigation history and
resumes with Last-Event-ID. Watch/Stop/history controls are on the local test page.

**P3.4:** operators can enqueue durable investigation workflow checks. PostgreSQL
outbox/leases and Redis/BullMQ recover interrupted work. Results explicitly say no
AI or telemetry investigation has been performed.

## Run the Sentinel API locally (P3.1-P3.5)

From `V:\sentinel\sentinel`, with Node/npm dependencies installed and Docker Desktop running:

```powershell
.\.venv\Scripts\python.exe scripts/api-local.py
```

This creates ignored `.env.api` credentials, starts PostgreSQL on loopback port 55434
and Redis on 56379, builds/migrates/seeds the API, listens on 3000, and runs a separate
dispatcher/worker process. Keep the terminal
open. **Manual setup:** create your own local account in a second terminal, replacing
the example email. Enter a unique 12-128 character password at the hidden prompts;
do not send it in chat or include it in command arguments.

```powershell
.\.venv\Scripts\python.exe scripts/api-user.py create --email you@example.com --role ADMIN
```

Open the [login testing page](http://localhost:3000/auth-test), log in, and use its
profile/services/incidents buttons. Direct navigation to protected JSON endpoints
without an Authorization header now correctly returns 401. Readiness remains public
at [localhost:3000/ready](http://localhost:3000/ready). The full dashboard is a later task; live progress is available on the test page. Local credentials/signing secret remain in ignored .env.api;
the application is loopback-only and public hosting is not yet configured.

```powershell
# Isolated real-database verification, including outage and restart checks:
.\.venv\Scripts\python.exe scripts/verify-p3.py --task P3.5
```

Ctrl+C stops the API. To stop its database without deleting the volume:

```powershell
docker compose --env-file .env.api -f infrastructure/compose.api.yaml down
```

## Learn and track progress

- [Complete P1 learning guide](docs/P1-LEARNING-GUIDE.md): concepts, architecture,
  file walkthroughs, commands, positive/negative tests, debugging, and exercises for
  every task P1.1-P1.7.
- [Measured progress and results](docs/PROGRESS.md): commands, outcomes, limitations,
  commit references, and pending student checkpoints.
- [Complete P2 learning guide](docs/P2-LEARNING-GUIDE.md): SQL/transactions,
  idempotency, containers, version switching, file walkthroughs and exercises.
- [Agent contract](AGENTS.md) and [master roadmap](SENTINEL_CODEX_MASTER_PLAN.md).

Implementation verification is separate from student mastery. Questions and
independent exercises remain pending until the student completes them. P3.1-P3.3 were
approved. The user approved completing P3.4/P3.5 together; P4 requires new approval.
Payments remain simulated. Local database and
deployment records are real in PostgreSQL mode. Project commits are published to
the configured GitHub remote; no external application deployment has occurred.

## P2: persistent local demo with Docker

Install/start Docker Desktop with Linux containers. With dependencies installed:

```powershell
.\.venv\Scripts\python.exe scripts/init-local.py
docker compose --env-file .env -f infrastructure/compose.yaml config --quiet
docker compose --env-file .env -f infrastructure/compose.yaml up -d --build --wait
```

Expected: database/payment/checkout healthy and migration service exited 0.
`init-local.py` creates ignored random credentials once and preserves an existing
.env. Do not print rendered Compose secrets; `config --quiet` checks without them.
Database port is 55432 on host loopback, 5432 inside Compose. A named volume retains
data. App-container listeners are only published to host loopback.

```powershell
$body = @{ order_id=[guid]::NewGuid().ToString(); amount_minor=12500; currency='INR' } | ConvertTo-Json
$headers = @{ 'Idempotency-Key'=[guid]::NewGuid().ToString() }
Invoke-RestMethod http://127.0.0.1:3001/checkout -Method Post -ContentType 'application/json' -Headers $headers -Body $body
# Repeat the exact body/key: same payment_id, no additional simulated charge.
```

Same key with a different payload, or a new key for a paid order, returns 409.
Missing keys default to order_id for P1 compatibility. Requests may retry transient
dependency failures once with the same body/key and a 50 ms pause. No retries on
conflicts or invalid responses. Per-attempt deadlines remain bounded.

Version switching (default is a plan; --apply changes only local payment):

```powershell
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v1
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v1 --apply
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v2-timeout --apply
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v1 --apply
```

Prefer clean committed source. Explicit --allow-working-tree labels uncommitted
source with its content hash and unknown commit. Registered versions are bound to
source/configuration/image ID; old cached images support rollback. /version and
the database registry expose version/time/identity, not credentials. A successful
readiness check does not imply successful checkout under an intentionally bad profile.

For native PostgreSQL verification independent of Docker:

```powershell
.\scripts\setup-postgres.ps1
npm run verify:p2
```

For actual image/container/volume/version verification, with manual servers stopped:

```powershell
npm run verify:p2:compose
```

Reports are separate: .artifacts/p2-native-verification.json and
.artifacts/p2-compose-verification.json. Native success is not container evidence.
Verifier projects/data are isolated; volumes are retained. Do not use down -v or
prune volumes to fix a test. See the learning guide for constraints and debugging.

## Prerequisites and setup (Windows PowerShell)

Use Git, Node.js 24.x with npm 11.x, and Python 3.11+. Tested versions are recorded
in the progress log. A virtual environment isolates Python packages; explicit paths
avoid activation-policy issues. The engines field documents supported npm tooling
but does not strictly enforce it. Requirements pin the measured Python environment.

```powershell
Set-Location 'V:\sentinel\sentinel'
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r services/payment-service/requirements.txt
npm run build
```

For k6, use an existing installation or download the pinned portable v1.8.2:

```powershell
.\scripts\setup-k6.ps1
```

The setup script downloads Grafana's official GitHub release, verifies the archive
against its published SHA256, and extracts into ignored .tools. It does not modify
system PATH or install a machine-wide service. Checksum matching detects corruption;
it is not an independent publisher identity verification.

## Run the two services

Terminal 1, from the repository root:

```powershell
$env:PAYMENT_FAULT_MODE = 'normal'
$env:STORAGE_MODE = 'memory'
$env:PAYMENT_VERSION = 'unversioned'
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir services/payment-service --host 127.0.0.1 --port 3002 --no-access-log
```

Terminal 2:

```powershell
$env:PAYMENT_URL = 'http://127.0.0.1:3002'
$env:PAYMENT_TIMEOUT_MS = '2000'
npm run start:checkout
```

Terminal 3:

```powershell
curl.exe -i http://127.0.0.1:3001/health
curl.exe -i http://127.0.0.1:3002/health
$body = '{"order_id":"11111111-1111-4111-8111-111111111111","amount_minor":12500,"currency":"INR"}'
Invoke-RestMethod http://127.0.0.1:3001/checkout -Method Post -ContentType 'application/json' -Body $body
```

Expected: both health endpoints return 200; checkout returns a simulated succeeded
payment with a UUID. Payment docs: http://127.0.0.1:3002/docs and /openapi.json.
Stop with Ctrl+C. Rebuild/restart checkout after source changes. Restart payment
when changing its fault settings. Startup/completion logs include service context.

## Architecture and API contracts

```text
Client -> checkout (Node/Express, 127.0.0.1:3001)
           -> bounded HTTP POST -> payment (Python/FastAPI, 127.0.0.1:3002)
           <- validated simulated payment result
Both services -> JSON completion logs with a shared X-Request-ID
```

| Route                         | Success                         | Invalid/failure behavior                                                                                            |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET /health on either service | 200, status ok and service name | Responsiveness only; no dependency readiness claim                                                                  |
| POST /payments on payment     | 201, simulated payment result   | 422 invalid contract; 413 oversized body; 503 injected error                                                        |
| POST /checkout on checkout    | 201, validated payment result   | 422 invalid contract; 415 wrong media; 400 malformed JSON; 413 oversized body; 502 dependency failure; 504 deadline |
| Unknown checkout route        | Not applicable                  | 404 JSON error                                                                                                      |
| GET /openapi.json on payment  | 200, API schema                 | No application authentication in this local demo                                                                    |

Request: UUID order_id, integer amount_minor from 1 to 100,000,000, currency INR or
USD. Extra fields are rejected. Response adds payment_id and status succeeded.
Amount 12500 means 125.00 currency units. No cards or real charges. P2 persists and
deduplicates simulated payments in PostgreSQL mode; explicit memory mode is
non-durable. Successful bodies stay small; errors use
`{error:{code,message},request_id}`. Response headers include X-Request-ID. Invalid
incoming IDs are replaced with UUIDs. IDs provide correlation, not authorization.

JSON bodies are bounded at 8 KiB; checkout's downstream response is bounded at
16 KiB with a configurable 50-10000 ms deadline. Redirects are rejected. Only local
HTTP payment origins are accepted. Logs exclude bodies, credentials, raw URLs,
query strings and raw exception messages. Uvicorn lifecycle diagnostics may be
plain text; --no-access-log avoids URL access logging.

## Deterministic fault demonstration

Faults are disabled by default. Service processes do not automatically load
.env.example; Compose and operator CLI helpers explicitly load ignored .env.
Only the payment process's startup environment enables faults;
request headers/query/body cannot enable them.

Stop payment, then restart it with one mode:

```powershell
$env:PAYMENT_FAULT_MODE = 'error'
# Run the same Uvicorn command: direct payment gives 503, checkout gives 502.
```

Or simulate a deadline breach (checkout default deadline is 2000 ms):

```powershell
$env:PAYMENT_FAULT_MODE = 'latency'
$env:PAYMENT_FAULT_DELAY_MS = '3000'
# Restart payment: checkout gives 504; payment may finish after checkout times out.
```

For ad-hoc P1 faults, use PAYMENT_VERSION=unversioned; named P2 versions select
their fixed profile instead. Normal/latency/error are the only modes; delay is 1-5000 ms. Health remains 200
during an injected payment fault. Restore mode normal and restart when finished.
Random fault selection is not used; IDs and measured timings naturally vary.

## Verification and formatting

Stop manual servers before the combined suite. It refuses occupied ports and
stops only child processes it creates.

```powershell
npm test
npm run test:payment
npm run format:check
.\.venv\Scripts\python.exe -m ruff check services/payment-service scripts/verify-p1.py
npm run verify:p1
```

The combined suite runs unit/HTTP regressions, formatting/lint, seven real-service
scenarios, shared-ID/redaction checks, and three 20-request k6 loads. It writes
ignored .artifacts/p1-verification.json with RUNNING/FAILED/PASSED status and per-run
logs/metrics. A failed run cannot leave the previous success report marked current.
For an explicit partial check without k6:

```powershell
.\.venv\Scripts\python.exe scripts/verify-p1.py --skip-k6
```

This reports PASSED_WITH_LIMITATIONS, not a full load verification. Prettier is a
pinned developer formatter; `npm run format` fixes its supported source/docs files.
Python formatting uses `python -m ruff format` through the virtual environment.

## Debugging and limitations

- Connection refused: inspect service startup output and ports 3001/3002.
- EADDRINUSE: stop your previous server, never an unfamiliar process blindly.
- 422: check names/types/bounds; payment deliberately does not echo rejected input.
- 502: inspect payment availability and contract; 504: compare delay with deadline.
- A timeout does not prove payment did not run. Reconcile by replaying the same
  body/key; P2 retries are bounded and rely on payment's durable deduplication.
- Search both service outputs for the same request_id to follow one call.
- Sandbox EACCES/EPERM can block local sockets/workspace links; use an environment
  with those permissions. Do not weaken application validation to fix tool limits.
- FastAPI TestClient currently emits a Starlette httpx deprecation warning; tests
  pass. This compatibility warning is recorded for a future dependency update.
- Tiny local k6 runs verify behavior, not production capacity or stable SLOs.
- .gitignore cannot protect already tracked secrets. Commit examples only.

## P4.1: request metrics

Checkout and payment now expose GET /metrics with request counters and latency
histograms. Known routes/methods/statuses form bounded labels; raw URLs, IDs and
credentials are excluded. Registries reset on service restart; Prometheus history
collection is P4.2. No database migration or new secrets are required.

See [P4 learning guide](docs/P4-LEARNING-GUIDE.md) for concepts, full file/function
walkthrough, exact commands, tests, debugging, hosted manual setup and exercises.
Use npm run verify:p1 to test metrics across real normal/faulted two-service traffic.
The existing P2 Compose workflow verifies the same services with real PostgreSQL.
Hosted metric endpoints must stay private to the collector; public deployment has
not been configured. P4.1 is approved; later P4 tasks retain learning checkpoints.

P4.2 adds Prometheus at http://localhost:9090 with bounded persistent storage.
Run `.venv\Scripts\python.exe scripts/observability-local.py` for the supervised
local demo or `scripts/verify-p4.py --task P4.2` with that Python interpreter for
real scrape/fault/restart checks. See the P4 guide and annotated queries in
infrastructure/observability/queries.promql. Hosted collectors remain unconfigured.

P4.2-P4.5 now add persistent Prometheus metrics, Alloy/Loki JSON logs, explicit
OpenTelemetry traces in Tempo, and grouped authenticated Alertmanager incident
creation. Each task has its own walkthrough, results, manual hosted setup and
exercises in docs/P4-LEARNING-GUIDE.md and docs/PROGRESS.md.

Start the main API with `.venv\Scripts\python.exe scripts/api-local.py`, then the
observability demo with `.venv\Scripts\python.exe scripts/observability-local.py`.
The demo uses simulated memory-only payments and can create real **demo incidents**
in the preserved local Sentinel database when a sustained fault is injected.
The supervisor refuses occupied demo ports and stops its owned processes on Ctrl+C.
Collector containers/volumes remain until explicitly stopped with Compose (no -v).

Local interfaces: Prometheus :9090, Loki :3100, Tempo :3200, Alertmanager :9093, existing
API/auth-test :3000 and demo metrics :3001/:3002. All published interfaces are loopback.
No additional manual setup is required in the checked environment. Public hosting,
private authenticatedTLS collector access, durable provider storage/retention and
production alert thresholds are still unprovisioned; use each task's hosting steps.
No alert or telemetry content can execute remediation. P5 is not started.

## P5 evidence and hosted setup

P5 adds deterministic read-only Prometheus, Loki and deployment-history tools,
coverage-aware comparisons and four immutable, hash-verified snapshots per
successful collection attempt. The local launcher now starts the internal Python
collector alongside the API and worker. No LLM call or remediation is performed.

- [P5 task-by-task concepts, architecture, files and tests](docs/P5-LEARNING-GUIDE.md)
- [Local restart, browser testing and manual checklist](docs/MANUAL-SETUP.md)
- [Cloud PostgreSQL and public hosting steps](docs/HOSTED-SETUP.md)

Use `scripts/api-local.py` for the full local P5 stack. Standalone
`npm run start:worker` with only `.env.api` retains P3 workflow-check mode unless
you explicitly configure the separate evidence URL/key; it does not gather
telemetry in that compatibility mode. The shared deployment must use hosted
storage/processes. Current loopback bindings and remote bootstrap restrictions
still need the reviewed deployment work listed in the hosted guide.
