# Sentinel progress

Current phase/task: P10.5 approved demo workflow implemented; acceptance checks in progress; hosted setup deferred
Status: P1-P9 LOCAL SOFTWARE VERIFIED; cloud deployment, chat-model quality and learner checkpoints remain open
Last fully accepted software phase: P9 local dashboard with role/evidence/streaming/browser checks; public hosting and production remediation unperformed
Last completed learner checkpoint: none confirmed

## P1.1 task record

- Approval: user approved P1.1 on 2026-10-15, using the existing nested repository.
- Concepts: Git working tree/staging/commits/remotes, Node runtime, npm manifests
  and lockfiles, TypeScript compiler purpose, generated files and secret exclusion.
- Files: AGENTS.md, SENTINEL_CODEX_MASTER_PLAN.md, README.md, .gitignore,
  package.json, package-lock.json, docs/PROGRESS.md.
- Design: minimal private npm package; no external dependencies. TypeScript
  installation/configuration is deferred to actual checkout source in P1.2.
- Commands run: `npm install`, `npm ci`,
  `npm ci --ignore-scripts --no-audit --no-fund --offline`,
  `git rev-parse --show-toplevel`, `git remote -v`,
  `git check-ignore --no-index .env`,
  `git check-ignore --no-index .env.example`; original/copied documents compared
  with `git diff --no-index` and initially had no content differences. Only trailing
  blank lines were then removed from the copied documents because the staged
  whitespace check flagged them. The instructions and roadmap text are preserved.
- Positive test result: installation succeeded; an additional offline installation
  preserved the SHA256 hash of package-lock.json. Repository root and origin match
  the approved location/URL. The package currently has no external dependencies.
- Negative test result: `.env` is ignored (exit 0), while `.env.example` is not
  ignored (exit 1). In a disposable directory containing only package.json,
  `npm ci --prefix <temporary-directory> --ignore-scripts --no-audit --no-fund
--offline` failed with EUSAGE, correctly requiring a lockfile.
- Test limitation: the initially planned mismatched-manifest test hit ENOTCACHED
  while npm tried to resolve the invented dependency offline. That result does
  not prove mismatch validation; the deterministic missing-lockfile check above
  replaced it. No real dependency was added to this repository.
- Whitespace validation: `git diff --cached --check` is required before commit.
- Known limitations: no running application or application tests; package tooling
  only. Git ignore rules cannot protect secrets already tracked in history.
- My own explanation of data flow: pending student response.
- Independent exercise completed: pending student action.
- Commit reference: the P1.1 implementation commit containing this record; find it
  with `git log --oneline --grep="initialize repository foundation"`.
- Next task (not approved yet): P1.2, checkout Express server with GET /health.

## Learner checkpoint

1. How do editing, staging, committing, and pushing differ?
2. Why commit package-lock.json while ignoring node_modules?
3. Why can an already committed secret remain exposed despite .gitignore?

Exercise: add a README sentence in your own words and explain its `git diff`.
P1.1 remains pending learner completion even after implementation checks pass.

## P1.2 task record

- Approval: user approved the P1.2 explanation/file/test plan with "continue" on
  2026-10-15. P1.1 learner checkpoints remain pending; not marked complete.
- Concepts: HTTP methods, routes, ports, status codes, JSON content type,
  middleware order, TypeScript compilation, ES modules, workspaces, async tests.
- Files changed: root package.json/package-lock.json, README.md, this log;
  services/checkout-service/package.json, tsconfig.json, src/app.ts,
  src/server.ts, test/app.test.ts.
- Dependencies: Express 5.3.0 at runtime; TypeScript 5.9.3, @types/node 24.19.2,
  @types/express 5.0.6 for development. Exact direct versions and resolved
  transitive packages are recorded in the manifests/lockfile.
- Data flow: Node listens on loopback port 3001; Express dispatches GET /health
  to fixed 200 JSON, then final middleware returns JSON 404 for unmatched requests.
  app.ts constructs routes without listening; server.ts starts the listener.
- Commands: dependency installation, `npm run build`, `npm test`,
  `npm ls --workspace=@sentinel/checkout-service --depth=0`,
  `npm ci --no-audit --no-fund --fetch-retries=0 --fetch-timeout=10000`.
- Positive test: GET /health returned 200, application/json and the exact expected
  body. npm ci succeeded and preserved the lockfile SHA256 hash.
- Negative tests: GET /unknown and POST /health returned 404, application/json
  and the expected error body. Node test runner: 3 passed, 0 failed.
- Environment issues: initial workspace installation failed with Windows EPERM
  on a workspace link; sandboxed registry lookup later failed with ENOTFOUND.
  Authorized installation outside the sandbox succeeded. Initial HTTP tests
  failed with loopback EACCES in the sandbox; authorized rerun outside it passed.
  No application changes were needed to bypass these environment restrictions.
- Startup/occupied-port checks: a bounded Node smoke script started the compiled
  server, verified its startup message and real GET /health, then started a second
  copy. The second copy reported EADDRINUSE and exited 1. The script stopped its
  own server afterward. To reproduce manually: `npm run build`, run
  `npm run start:checkout` in one terminal, request /health in another, then run
  `npm run start:checkout` again while the first copy is active. Stop the first
  copy with Ctrl+C afterward.
- Known limitations: fixed local port; health is process responsiveness only.
  No payment/database checks, request IDs, centralized errors, auth, or telemetry.
  Express provides HEAD handling for GET routes; unsupported POST returns 404.
- My own explanation of data flow: pending student response.
- Independent exercise completed: pending student action.
- Commit reference: P1.2 implementation commit containing this record; find with
  `git log --oneline --grep="add checkout service health endpoint"`.
- Next task (not approved): P1.3, payment FastAPI health endpoint.

### P1.2 learner checkpoint

1. How does a port differ from a route?
2. Why can /health succeed while a future payment dependency is unavailable?
3. Why separate app creation from opening a listening port?

Exercise: add a fixed `"component":"demo"` response field, update the test body,
and run `npm test`. Explain why the unchanged test would reject the new response.

## P1.3 task record

- Approval: user authorized continuing through P1.7 with complete documentation.
- Files/concepts/commands/walkthrough/exercise: docs/P1-LEARNING-GUIDE.md, P1.3.
- Commands: Python 3.11.9 venv; pip install -r requirements.in; pip freeze to
  requirements.txt; pytest services/payment-service -q; pip check; Ruff check/format.
- Positive: health/OpenAPI/docs passed. Negative: unknown route returned 404.
  Payment tests: 3 passed. Existing checkout regressions: 3 passed.
- pip check: no broken requirements. Ruff import ordering corrected.
- Environment: sandbox pip could not reach packages; approved retry succeeded.
  Async TestClient stalled in sandbox; stopped those runs and passed outside it.
- Warning: installed Starlette deprecates its httpx-backed TestClient; currently
  working, warning recorded rather than concealed. Revisit when updating tooling.
- Learner answers/exercise: pending. No claim of student completion.
- Commit: find with git log --grep="add payment health server".

## P1.4 task record

- Scope/flow/file walkthrough/commands/questions: P1-LEARNING-GUIDE.md, P1.4.
- Added models.py; updated main.py/test_main.py and learning documentation.
- `python -m pytest services/payment-service -q` using .venv: 14 passed, including
  the three P1.3 regressions. TestClient deprecation warning remains documented.
- Positive: valid simulated payment returns 201, UUID, expected validated fields.
- Negative: zero/negative/oversized/noninteger amount, invalid UUID/currency,
  extra/missing fields return 422. No gateway called; no real charges or storage.
- Ruff import fixes and formatting applied. Learner checkpoint/exercise pending.
- Commit: find with git log --grep="validate demo payment contracts".

## P1.5 task record

- Concepts/flow/files/walkthrough/commands/questions: P1-LEARNING-GUIDE.md, P1.5.
- Checkout now validates POST /checkout and calls payment over bounded HTTP.
- `npm test`: 11 passed, 0 failed, including P1.2 regressions. Payment source
  unchanged since its 14 passing tests. Real two-runtime integration follows in
  the final P1 suite; these downstream scenarios use an explicit HTTP test double.
- Positive: payment contract returned 201. Negative: unavailable, timeout,
  malformed/oversized/mismatched upstream, invalid checkout, bad media/config.
- Timeout 504; other dependency failures 502; no retries or persistence.
- Documentation/environment example added; learner exercise/answers pending.
- Commit: find with git log --grep="connect checkout to payment over bounded HTTP".

## P1.6 task record

- Detailed reference: P1-LEARNING-GUIDE.md, P1.6 (concepts/flow/files/errors/debug).
- `npm test`: 12 passed, including health/404, payment boundary regressions, safe
  request IDs, invalid JSON/input and 8 KiB body cap. pytest: 17 passed, including
  health/OpenAPI/payment, chunked size cap, safe 500 and secret-marker redaction.
- Ruff check passed; Python formatting applied. Shared IDs forwarded in HTTP test
  double checks; full cross-runtime log correlation will be checked in P1.7.
- Intentional contract change: errors now include request_id; successful health
  and payment bodies unchanged. All HTTP responses carry X-Request-ID.
- Startup logs now use JSON; earlier P1.2 plain startup text is historical.
- Secrets absent from targeted log/error tests; no claim of comprehensive audit.
- Learner checkpoint/exercise pending. Commit: git log --grep="correlate requests".

## P1.7 task record and final P1 verification

- Authorization: user requested continuing until P1 is finished, documenting every
  task and checking regressions. P2 remains unapproved. Learner work stays pending.
- Complete reference: P1-LEARNING-GUIDE.md covers P1.1-P1.7 concepts, prerequisites,
  architecture/data flow, files, implementation, walkthrough, commands, errors,
  security/tradeoffs, positive/negative tests, debugging, questions and exercises.
- Files: payment config.py/main.py/models.py/test_main.py; scripts/setup-k6.ps1,
  load-checkout.js, verify-p1.py; pyproject.toml; root manifests, environment example,
  ignore rules, README and learning/progress docs. Checkout files were formatted
  using newly pinned Prettier; runtime behavior verified afterward.
- Faults: startup-only normal (default), latency (1-5000 ms), error (503). Request
  inputs cannot enable faults. Health remains responsive. No random fault sampling.
- Payment OpenAPI now describes the sanitized error envelope, including 422/503.
- Added developer tools: Prettier 3.9.10 (npm lock); Ruff 0.17.1 (Python requirements).
- k6: official portable v1.8.2, commit 682f083071. Archive SHA256 verified against
  published manifest: C763B4796147BF796F3B7890B84A87A5042A010905DB75097AF1E61857FDD0C2.
  Binary/archive live only in ignored .tools; no machine-wide installation.

### Commands actually run

```powershell
# Repository root: V:\sentinel\sentinel
.\scripts\setup-k6.ps1
.\.venv\Scripts\python.exe -m ruff check services/payment-service scripts/verify-p1.py --fix
.\.venv\Scripts\python.exe -m ruff format services/payment-service scripts/verify-p1.py
npm run format
.\.venv\Scripts\python.exe scripts/verify-p1.py
npm run verify:p1 -- --help
.\.venv\Scripts\python.exe -m pip check
npm ci --no-audit --no-fund --fetch-retries=0 --fetch-timeout=15000
```

The final verifier run began at 2026-10-15T15:45:18.261424+00:00
(2026-10-15 21:15:18 IST). It reported PASSED, k6_skipped=false.
The verifier executes npm test, npm format:check, pytest, Ruff check/format-check,
real service scenarios, k6 input guards and load runs. The npm wrapper's --help
was separately checked. Final npm ci installed 79 packages and preserved the exact
lockfile SHA256; pip check reported no broken requirements.

### Measured results

- Checkout: 12 tests passed, 0 failed. Original health/404 behavior preserved;
  validation, unavailable/timeout/malformed/oversized/mismatched dependency data,
  request IDs, body limits and secret-marker checks passed.
- Payment: 22 tests passed, 0 failed. Health/OpenAPI, valid/invalid payments,
  safe errors/logs, chunked body limit, default/repeated/configured faults passed.
- Python lint/format and Prettier checks passed; Git whitespace check required
  before commit. No claims about unconfigured additional lint tooling.
- Seven real Node/Uvicorn scenarios passed, three checkouts each (21 scenario
  requests): normal-a/b=201, error-a/b=502, latency=201, timeout=504, unavailable=502.
- Cross-service request IDs matched for all scenarios with a payment listener.
  Targeted fake secret markers were absent from service logs and public errors.
- Occupied checkout startup exited 1 with EADDRINUSE; invalid configuration exited
  1 with sanitized JSON. Verifier refused an intentionally occupied port, marked
  its current report FAILED, and left that test listener untouched. The subsequent
  full run replaced it with the new PASSED report.
- k6 rejected a nonlocal target and invalid expected status before traffic.
- Three k6 runs, 20 requests each, 1 virtual user, 30-second scenario cap:

| Run      | Expected status | Requests | Matching status | Measured p95 |
| -------- | --------------- | -------- | --------------- | ------------ |
| normal-a | 201             | 20       | 100%            | 9.74 ms      |
| error-a  | 502             | 20       | 100%            | 7.98 ms      |
| timeout  | 504             | 20       | 100%            | 217.02 ms    |

All request-ID checks and p95 < 3000 ms thresholds passed. The 502/504 runs have
100% HTTP failures by design; that is the observed fault, not a failed threshold.
These small local samples demonstrate behavior, not capacity, SLOs or general
performance claims. Timings vary with hardware/scheduling; outcome modes repeat.

### Evidence, limitations, and next boundary

- Generated raw evidence: .artifacts/p1-verification.json, service .log files,
  k6 summaries. Reports/tools are ignored, not committed. This dated snapshot is
  the durable record; reruns overwrite generated evidence with a new run status.
- Both local ports 3001 and 3002 were confirmed released after verification.
- TestClient's Starlette/httpx deprecation warning remains; tests currently pass.
  Revisit the dependency/test-client combination during a deliberate tooling update.
- No real payments, idempotency, durable state, AI, telemetry backend, containers,
  deployment, or production-readiness claim. No secrets needed or committed.
- All independent exercises and learner explanations remain pending. The software
  implementation gate passed; student mastery has not been asserted.
- Commit: git log --grep="complete deterministic P1 fault and load verification".
- Next task: P2.1, PostgreSQL schema/migrations, requires explicit user approval.

## P2 task records (P2.1-P2.4)

### Authorization and current boundary

The user requested proceeding with P2 similarly to P1, authorizing local P2.1-P2.4
implementation, documentation and verification. The user chose to install/start
Docker Desktop. No system-wide Docker/PostgreSQL installation was performed by
Codex. Docker remains unavailable at the latest check; container acceptance is
explicitly pending, not waived. P3 has not been started or approved.

P2-LEARNING-GUIDE.md provides concepts, prerequisites, architecture/data flow,
file/function walkthroughs, schema/API changes, commands, positive/negative tests,
debugging, security/tradeoffs, questions and independent exercises for each task.
README is the operational quick start. Student exercises/answers remain pending.

### P2.1: PostgreSQL schema and migration owner

- Added database/migrations/001_demo_payments.sql and scripts/migrate.py.
- Payment owns demo_orders/demo_payments in a single transaction; checkout remains
  an HTTP client with no database writer. PK/FK, amount/currency/status checks,
  unique order/key, UTC timestamps and parameterized SQL protect the demo contract.
- store.py supplies explicit MemoryStore and PostgresStore. PostgreSQL mode never
  silently falls back. /ready checks storage/schema; /health remains liveness.
- psycopg 3.3.6 + binary driver/tzdata pinned in Python requirements.
- Migration ownership: explicit CLI/one-shot container only; advisory serialization,
  filenames/checksums, transactional application. Repeated migration is a no-op;
  a changed fixture is rejected without editing applied source/history.
- Real PostgreSQL 17.11 verified constraints/rollback and persisted payment/order
  state across service AND database restart. Memory tests are not that evidence.

### P2.2: idempotency and bounded retries

- Added optional UUID Idempotency-Key to checkout/payment; omitted key defaults to
  order_id to preserve P1 callers. Repeated identical key/payload returns original
  result. Changed payload or another key for a paid order returns 409.
- Postgres transaction-scoped key/order locks plus uniqueness prevent duplicates.
- Checkout retries only transient network/timeout/502/503/504 failures, at most
  twice, same key/body, fixed 50 ms pause, bounded per-attempt deadlines. No retry
  for conflicts, malformed or mismatched responses. PAYMENT_MAX_ATTEMPTS is 1 or 2.
- Real database: 16 concurrent saves produced exactly one payment. Eight concurrent
  real HTTP replays returned the original result. A 50 ms caller timeout followed
  by eventual commit was reconciled with the same key/payment UUID.
- Added test_store.py and idempotency.test.ts; original tests remain regressions.

### P2.3: containers prepared, engine acceptance blocked

- Added both Dockerfiles, .dockerignore and infrastructure/compose.yaml.
- Compose defines database, one-shot migration, payment and checkout; explicit
  health/readiness ordering; named data volume; loopback host ports 3001/3002/55432;
  non-root app users; reduced app-container privileges/read-only filesystems.
- Base versions and manifest digests were checked against Docker Hub and pinned:
  Node 24.11.1-bookworm-slim, Python 3.11.14-slim-bookworm, PostgreSQL 17.11-bookworm.
- scripts/init-local.py generates ignored random local credentials once; examples
  contain fake placeholders. No credentials are printed or passed in command text.
- Optional scripts/setup-postgres.ps1 downloads/extracts only the portable EDB
  runtime into ignored .tools; no Windows service/PATH changes. Archive SHA256
  matches the measured official HTTPS download (not a signed publisher manifest):
  6EABDF00D2893713B75DB4336A23C3FDF505F056E217EC6E2E95D901750CFEA3.
- Dockerfile/YAML source prepared and YAML formatting parsed successfully. This is
  NOT evidence of image builds, docker compose up, health checks or volume behavior.
- Compose verifier was actually attempted on 2026-10-16T06:00:25.053621+00:00:
  BLOCKED / DockerUnavailable. Docker not on PATH or in the standard per-machine
  or per-user installation locations. No containers were started by that attempt.
- Next required command after Desktop/Linux engine is ready: npm run verify:p2:compose.

### P2.4: local versions and registry

- Added versions.json profiles: payment-v1 normal, payment-v2-timeout 3000 ms,
  payment-v3-error 503. These are immutable demo configuration profiles of the same
  code, not falsely claimed independent source releases. /version exposes safe
  source/commit/deployment metadata. Named profiles override ad-hoc P1 fault flags.
- Added 002_demo_deployments.sql: version bindings and PENDING/ACTIVE/SUPERSEDED/
  FAILED history, unique active/pending deployment and service/time index.
- deployment_registry.py checks source/config/image identity before activation.
  local_support.py supplies safe config/source/CLI helpers. switch-payment.py
  defaults to a plan; --apply is fixed to local payment and validated projects.
  Cached Docker image IDs support rollback; arbitrary commands are not accepted.
- Native real-process sequence verified: healthy -> timeout -> error -> healthy.
  Seven deployment records, exactly one final ACTIVE; mismatched identity and
  changed source under an existing version name were rejected.
- Actual Docker image switch/rollback remains unverified with the missing engine.
  Native evidence is labeled native and does not close P2.3's container gate.

### Commands and measured verification

```powershell
# From V:\sentinel\sentinel
.\scripts\setup-postgres.ps1
.\.venv\Scripts\python.exe scripts/verify-p2.py --backend native
.\.venv\Scripts\python.exe scripts/verify-p2.py --backend compose
.\.venv\Scripts\python.exe scripts/verify-p1.py
.\.venv\Scripts\python.exe scripts/switch-payment.py payment-v1
.\.venv\Scripts\python.exe -m ruff check services/payment-service scripts
.\.venv\Scripts\python.exe -m ruff format --check services/payment-service scripts
.\.venv\Scripts\python.exe -m compileall -q services/payment-service scripts
.\.venv\Scripts\python.exe -m pip check
npm run format:check
```

- Native P2 run: started 2026-10-16T05:51:58.265071+00:00, PASSED. Last runtime
  registry verification: 2026-10-16T05:53:17.920550+00:00. Report includes restart
  persistence, constraints/rollback, migration replay/checksum guard, concurrency,
  timeout reconciliation and version negatives. No real charges were made.
- Runtime source SHA256:
  89d1c40ef02c7db2b3043d3424f32012d9cb47f33f2f490dc26a3b2e59f8c4cf.
  Commit was honestly unknown during the uncommitted test run, not mislabeled HEAD.
- Post-P2 fast regressions: 14 checkout tests and 27 payment tests passed, 0 failed.
- Full P1 baseline rerun passed all seven scenarios and three 20-request k6 loads,
  with matching status/ID thresholds. It explicitly isolates memory, unversioned
  mode and one attempt to preserve the P1 baseline independently of P2 settings.
- Ruff lint/format, Prettier, Python compile and pip consistency checks passed.
  The previously documented Starlette/httpx TestClient deprecation warning remains.
- Initial native verifier attempt hit inherited Windows stdout-pipe handles in
  pg_ctl startup; the owned cluster was explicitly stopped. Fixed to file-based
  control output and guaranteed cleanup; subsequent full native runs passed.
- Reports remain separate: .artifacts/p2-native-verification.json (PASSED),
  .artifacts/p2-compose-verification.json (BLOCKED). Tooling/test data are ignored.
  Native clusters retain data but are stopped; no user volume/database was deleted.

### Remaining gate, learning work, commit

Docker Desktop/Linux engine must become available for actual builds, Compose health,
container restart/volume and container version-switch checks. P2 is not marked fully
complete until those pass. The user is handling that prerequisite; no approval is
being inferred from elapsed time. All student answers/exercises remain pending.
No production work, external deployment, pushes or P3 changes were performed.

Commit: find with git log --grep="persist idempotent demo payments".

### Repository publishing and authorship preference (2026-10-16)

The user authorized pushing project commits to the configured GitHub remote and
requested focused commits with descriptive messages and clear documentation.
Use the configured account as the sole author; do not add co-author trailers.
The configured identity is pvasB0-baymax <vsai3890@gmail.com>. Existing P1/P2
commits through 1191e1f were pushed successfully to origin/main. Future completed
parts should be committed and pushed individually after their relevant checks.
This supersedes the earlier local-only publishing status; P3 still requires approval.

### P2 Docker acceptance completed (2026-10-16)

The earlier Docker blocker is resolved. Docker Engine 29.8.2 reports Linux containers;
Compose v5.6.0 is available. Ran the actual command from the repository root:

```powershell
.\.venv\Scripts\python.exe scripts/verify-p2.py --backend compose
```

- Report run_at: 2026-10-16T10:46:00.977551+00:00; status PASSED,
  compose_verified true; artifact .artifacts/p2-compose-verification.json.
- Isolated project: sentinel-p2-verify-a6813821. Both application images built
  successfully from pinned base images; database and application health gates passed.
- Real PostgreSQL: 16 concurrent requests created one payment; constraints,
  transaction rollback, migration replay and checksum rejection checks passed.
- Eight concurrent HTTP replays and conflicting-request checks passed. Restarting
  the database/payment containers preserved the original payment identity.
- Container versions payment-v1 -> payment-v2-timeout -> payment-v3-error ->
  payment-v1 produced checkout HTTP 201 -> 504 -> 502 -> 201. Four deployment
  records were created, with exactly one ACTIVE at the end.
- The verifier removed only its test project's containers/network with compose
  down, without -v. Its database volume remains preserved. No containers remained
  running at the post-run check. No real charges or external deployment occurred.
- Native-only uncertainty/reconciliation and identity-negative checks remain
  separately evidenced by the earlier native report; this does not imply every
  native assertion is duplicated in the Compose verifier.

P2's software acceptance gates are now satisfied. Historical blocked results above
describe earlier attempts, not the current status. Student comprehension answers
and independent exercises remain pending. P3 requires explicit user approval.
Documentation-only follow-up: Prettier validation; application source unchanged.
Commit: find with git log --grep="record successful P2 container acceptance".

### Task commits and hosted application requirements (2026-10-16)

The user requests separate task commits identified as P3.1, P3.2, and so on, with
descriptive subjects and the existing sole-author/push policy. These preferences
are recorded in AGENTS.md for future sessions.

The target is a publicly reachable application with a hosted backend, durable
hosted database and real-time updates. The current P2 runtime is local only;
GitHub publishing does not host the running application or database. Provider
selection, provisioning and public deployment are not yet completed or approved.
Local PostgreSQL and Compose remain useful reproducible development/test options.
P2's database URL guard currently permits demo hosts only; supporting a hosted
database will require an explicitly planned configuration change with TLS and
appropriate validation, not merely replacing the URL in an environment file.

Each phase must explain hosted integration and list manual setup steps, required
environment variable names, verification and blockers, or explicitly state that
no manual setup is required. Hosting choices and costs must be discussed before
provisioning. Shared updates will use the planned persisted events/SSE flow in
P3.5, with authentication and suitable hosting support assessed before exposure.
No infrastructure provisioning or application deployment occurred in this update.
Manual setup required now: none; provider selection belongs in the deployment
architecture discussion before dependent implementation. P3 remains unstarted.

## P3.1: main API, migrations and service registry

### Concept and architecture/data flow

The main API owns Sentinel's monitored-service directory, separate from the demo
payment application's data. Browser -> Express controller -> response-validation
service -> PostgreSQL repository/pool -> dedicated database. All runtime records
come from PostgreSQL; no in-memory fallback or hardcoded HTTP result is used.
The two explicitly seeded records describe demo services, not discovered live health.

### Approval checkpoint and file plan

The user requested P3 and localhost previews. After the P3.1 concept/architecture,
file plan, test plan and hosting implications were explained, the user approved
implementation with "proceed" on 2026-10-16. Scope is P3.1 only. P3.2-P3.5 remain
unimplemented; the detailed reference is docs/P3-LEARNING-GUIDE.md.

### Implementation and walkthrough

- Added apps/api as an Express/TypeScript npm workspace with pg 8.23.1 and pinned
  type dependencies. Root build/test commands cover both Node workspaces.
- config.ts validates URL, TLS and port. Remote DB connections require verified
  TLS, URL query overrides are rejected and an optional provider CA is supported.
- db.ts bounds the pool to five connections, with connection/statement/lock/query
  deadlines. Idle client errors are handled without logging connection secrets.
- services.ts queries sorted records and validates/allowlists UUID, name, owner,
  environment and UTC timestamp output. app.ts provides health, schema readiness,
  GET /api/v1/services, safe errors, UUID correlation and safe completion logs.
- server.ts listens only on loopback, handles startup errors and bounded shutdown.
  Authentication is P3.3; no public application endpoint was deployed.
- API-owned migration ledger/checksums and advisory transaction lock are separate
  from P2. 001_services.sql defines primary/unique/check constraints. The explicit
  local seed is transactional and replayable; existing names are preserved.
- Added infrastructure/compose.api.yaml, scripts/api-local.py and scripts/verify-p3.py.
  Dedicated development settings live in ignored .env.api. The verifier uses a
  uniquely named database project and available ports, not the user's demo data.
- Updated checkout Dockerfile workspace manifest/install/build selection because
  adding a root workspace must not break the existing checkout container build.
- Updated .env.example, README, learning guide and formatting command coverage.

### Run/test: measured evidence (2026-10-16, UTC timestamps)

```powershell
.\.venv\Scripts\python.exe scripts/verify-p3.py
.\.venv\Scripts\python.exe scripts/verify-p2.py --backend compose
.\.venv\Scripts\python.exe scripts/verify-p1.py
```

- P3.1 verifier started 2026-10-16T11:15:28.459518+00:00 and PASSED. All 24 API
  tests passed with zero failures/skips, including actual PostgreSQL integration.
- Verified fresh schema readiness negative, migration apply/replay, changed/missing
  migration rejection, transactional rollback after invalid pending SQL, replayable
  seed, unique/check constraints, slow-statement cancellation and HTTP database output.
- Separately verified API process restart, real PostgreSQL outage (health 200,
  readiness/services 503), database restart and identical persisted records after
  recovery. Test-owned containers/network were removed and volume preserved.
- Report: .artifacts/p3-1-verification.json; test project sentinel-p3-1-96a1e409.
  Runtime content hash is recorded there; it is not mislabeled as a committed release.
- Final-source rerun started 2026-10-16T11:21:35.412153+00:00 and PASSED all 24
  tests plus process/database outage/restart checks. The latest report supersedes
  the initial run: project sentinel-p3-1-a04cc261, runtime source SHA256
  9be3f5e8d4fbf9f0abb13023c69e23c841f1e25485b127853018c19148bfc643.
  Source was reverified after formatting so the evidence matches final runtime files.
- P2 Compose regression started 2026-10-16T11:15:50.759144+00:00 and PASSED:
  rebuilt checkout image, 16 concurrent DB requests/one payment, eight HTTP replays,
  constraint/migration negatives, restart persistence, version statuses
  201 -> 504 -> 502 -> 201, four deployment records/one ACTIVE. Test volume retained.
- Full P1 regression started 2026-10-16T11:17:37.422244+00:00 and PASSED: 14 checkout
  tests, 27 payment tests, seven real-service scenarios and three 20-request k6 loads.
  Root npm test additionally ran API fast tests: 16 passed, database suite explicitly
  skipped in that invocation; actual DB coverage is the separate 24-test run above.
- The existing Starlette/httpx deprecation warning remains; it did not fail tests.
- First restricted-shell HTTP tests failed with loopback EACCES. Host-run tests
  resolved that execution boundary and passed; the failed attempt was not counted
  as success. Initial formatting check identified app.ts; formatting was corrected.
- Final Prettier check, Ruff lint/format, Python compilation, pip dependency
  consistency and git diff whitespace checks passed.

### Localhost preview and manual setup

Ran scripts/api-local.py, which generated ignored credentials, started the dedicated
development database, built the API, migrated and seeded it. Verified live HTTP 200
at http://localhost:3000/api/v1/services and readiness ready. Opened the URL in the
in-app browser and confirmed both JSON service records were visible. API and its
development database were left running for the user's requested testing.
Ctrl+C stops the helper/API; documented compose down stops its DB without deleting data.

No manual setup required for this local task beyond existing Node/Python/Docker
prerequisites. No hosted provider was selected or provisioned. Future deployment
requires managed database credentials/TLS, migration/runtime identities, backend
hosting, HTTPS and authenticated ingress. Redis/worker and SSE are later P3 tasks.
The guide gives required variable names and provider setup order; secrets stay out
of chat and source control. A GitHub push is not an application deployment.

### Debug, understanding check and commit summary

See docs/P3-LEARNING-GUIDE.md for file-by-file functions, async/error paths, exact
commands/expected outputs, debugging, three comprehension questions and an
independent third-service exercise. Student answers/exercise remain pending.

Commit: find with git log --grep="feat(P3.1): bootstrap Sentinel API and service registry".
Use the configured account as sole author, with no co-author trailers; push to origin.
P3.2 has not been implemented or implicitly approved by completion of this task.

## P3.2: incidents, transactional events and state transitions

### Concept and architecture/data flow

An incident is a report associated with a registered service, not proof of a detected
outage. It has severity and a controlled status lifecycle. Creation/status changes
flow through input validation, an incident repository, one PostgreSQL transaction
and event insertion. PATCH locks the row before validating its latest status.
Reads return validated records, bounded cursor pages and ordered durable history.

### File plan and approval checkpoint

The proposed schema, routes, state rules, concurrency behavior, tests and manual
setup implications were explained before implementation. User approved P3.2 with
"proceed" on 2026-10-16. Scope excludes P3.3 authentication and P3.5 streaming.

### Implementation and walkthrough

- Added migration 002_incidents.sql with incident/service and event/incident foreign
  keys, status/severity/resolution checks and pagination/filter indexes. Existing
  migration 001 and P2 schema/source were not changed.
- incidents.ts defines request/response contracts, strict parsers, the approved
  transition table, bigint cursor validation scoped to filters/incident, safe row
  readers and controlled error types.
- incident-repository.ts implements create/list/detail/status/events. Creation and
  status changes commit the incident and event together. SELECT FOR UPDATE under
  explicit READ COMMITTED serializes changes to the same incident. Repeating its
  current status is a successful no-op with no new event.
- incident-routes.ts adds POST/GET collection, GET/PATCH detail and GET event history.
  app.ts mounts 8 KiB JSON parsing, maps safe JSON/domain errors and extends readiness
  and allowlisted route logs. server.ts supplies the real database-backed store.
- Incidents page newest allocation first; events page oldest sequence first. Limits
  default to 20, maximum 100. Bigint positions avoid timestamp precision loss; gaps
  are permitted. Cursors do not provide snapshot isolation or authorization.
- Added unit/HTTP tests and sequential real-database incident checks. Extended the
  migration suite to upgrade an actual P3.1 schema with existing service records.
- Extended verify-p3.py with explicit P3.1/P3.2 selection, task-specific artifact
  reports and incident/event restart/outage verification. Added verify:p3.2 npm
  command; verify:p3.1 remains an explicit compatibility command. No dependencies added.
- Updated README and P3 learning guide with all functions/files, state rules,
  commands, positive/negative examples, limitations, hosting and learner exercises.

### Run/test: measured evidence (2026-10-16, UTC timestamps)

```powershell
.\.venv\Scripts\python.exe scripts/verify-p3.py --task P3.2
.\.venv\Scripts\python.exe scripts/verify-p1.py
```

- P3.2 full verifier started 2026-10-16T11:35:05.333767+00:00 and PASSED: 41 API
  tests passed, 0 failed, 0 skipped. Report .artifacts/p3-2-verification.json;
  isolated project sentinel-p3-2-bc7838d8.
- Verified schema upgrade preserving services, migration replay/checksum protection,
  incident creation/event pair, missing references, and a deliberately forced event
  insertion failure rolling back both creation and status changes.
- Eight concurrent requests for the same transition produced exactly one status
  event. A separate test observed a real lock wait in pg_stat_activity, committed a
  resolution in the lock-owning transaction, then verified the waiting MITIGATING
  request was rejected against the new RESOLVED status.
- Covered all 25 status pairs in unit tests, resolution/reopen/close timestamps,
  no-op repeats, constraints, incident filters and full incident/event page traversal,
  real HTTP endpoints, malformed JSON, extra/invalid fields, 8 KiB body limit,
  unsupported media and sanitized logs/errors.
- Runtime checks additionally confirmed a created incident and both events survive
  API termination/restart and real PostgreSQL stop/start. During the outage, health
  stayed 200, readiness/services/incidents/events/status writes returned 503, and
  recovery preserved the exact incident/history without a failed-write event.
- Runtime source SHA256:
  39dcc2d7de8ccbdcbe78d20854bb81cf65c94f58471d55785b4625bac8764433.
  Test-owned containers/network removed; volume preserved. Development DB untouched.
- P1 full regression started 2026-10-16T11:36:40.725996+00:00 and PASSED: 14 checkout
  tests, 27 payment tests, seven real-service scenarios, three 20-request k6 loads.
  Root npm test additionally ran 23 API fast tests successfully with the dedicated
  database suite explicitly skipped there; real DB evidence is the 41-test run above.
- Existing Starlette/httpx deprecation warning remains. P2 runtime/containers and
  lockfile dependencies were unchanged in this task; its prior container evidence
  is separate from the P1 regression and current API integration checks.
- Final Prettier, Ruff lint/format, Python compilation and whitespace checks passed.
  Final runtime source hash matched the successful P3.2 report before committing.

### Localhost preview, manual setup and hosting

Identified the existing API process and checked its api-local.py parent before
stopping only that owned process. Restarted using scripts/api-local.py: migration
002 applied to the existing development volume and existing service names preserved.
Created one labelled demo incident, not an automatically detected real outage:

- ID: 0d64432e-dc0d-4224-8743-557e204fbb2d
- Title: DEMO: checkout error investigation
- Status: INVESTIGATING; two events (creation and OPEN -> INVESTIGATING).
- Creation time: 2026-10-16T11:36:29.435Z; local preview recorded in ignored
  .artifacts/p3-2-local-preview.json.

Verified localhost incident list HTTP 200 and readiness ready, then opened
http://localhost:3000/api/v1/incidents in the existing in-app browser tab and
confirmed the demo record was visible. API and development DB remain running for
user testing. See the guide for restart/stop commands that preserve the volume.

No manual setup required for this local upgrade. For a future hosted release,
run migration 002 using the approved migration identity before API rollout, then
verify readiness and persistent data. No hosted database/account was provisioned;
no public deployment or new configuration secrets were needed. The API remains
loopback-only until authentication/authorization and hosting are addressed.

### Debug, understanding check and commit summary

See docs/P3-LEARNING-GUIDE.md, P3.2 sections, for exact commands, expected positive
and negative results, stale-process/migration/status/cursor debugging, three
comprehension questions and the independent resolve/reopen/history exercise.
Student mastery remains pending. Events are not yet a user-attributed audit trail
or live browser stream. POST creation retry deduplication is not implemented.

Commit: find with git log --grep="feat(P3.2): add incidents and transactional event history".
Commit/push uses the configured account as sole author without co-author trailers.
P3.3 remains unimplemented and requires its own explanation and approval.

## P3.3: login, password hashing, JWT and role permissions

### Concept, architecture/data flow and approval checkpoint

The task-specific concept/design was explained before coding and approved by the
user's "continue". Work continued across 2026-10-16/17 (Asia/Calcutta). Scope includes
an explicit local account lifecycle and testing surface, not public signup, hosted
deployment or remediation. P3.4 remains unapproved.

Login -> bounded validation -> shared PostgreSQL rate counters -> stored/dummy
password verification -> current-user recheck -> signed token. Protected request
-> signature/claim validation -> current account lookup -> backend permission check
-> existing service/incident operation. No UI-only authorization or runtime bypass.

### File plan, implementation and walkthrough

- Added migration 003_users.sql: unique normalized email, salted password hash,
  VIEWER/OPERATOR/ADMIN role, enabled flag, token version and timestamps. Login-limit
  rows use HMAC keys and indexed time windows. Prior applied migrations were unchanged.
- passwords.ts uses async Node scrypt N=131072/r=8/p=1, random 16-byte salt and
  32-byte derived key. Two concurrent derivations maximum, no unbounded queue,
  constant-time equal-length comparison and bounded password/encoded-hash inputs.
- auth.ts provides exact login parsing, required 32-byte hex environment secret,
  HS256 JWT signing/verification, safe profiles, current-user/token-version checks,
  permission matrix and Express guards. Tokens last 900 seconds with five-second
  tolerance; password/disable/enable invalidate older versions. Roles are reloaded.
- auth-store.ts owns parameterized user lookups and atomic 15-minute counters
  (10 attempts/email, 30/direct peer IP), shared across instances. It supports
  explicit user creation, password reset, role change and disable/enable operations.
- app.ts mounts login before the authenticated API prefix, protects reads and
  incident writes, adds /auth/me and public static testing page with restrictive
  CSP. server.ts requires a valid signing secret before listening and supplies real
  PostgreSQL auth. Protected requests fail closed when authentication is unavailable.
- user-cli.ts accepts bounded JSON on stdin and targets only explicit local demo
  databases. api-user.py prompts for passwords twice without echo, never through
  arguments/chat. No default account/password or public registration endpoint exists.
- api-local.py adds a missing random secret to ignored .env.api without replacing
  existing credentials, applies migration 003, and starts the loopback API.
- auth-test.html/.js/.css provide login/profile/services/incidents and permission
  testing. Tokens stay in memory and are omitted from the display panel; password
  input clears after attempts. No token is stored in URLs, cookies or browser storage.
- Added auth unit/integration tests and an explicitly named fake auth fixture for
  earlier domain tests. These fixtures do not enter the running server.
- Extended verify-p3.py with explicit test-account bootstrap, authenticated requests,
  P3.3 reports and authenticated restart/outage checks. Added jose 6.2.12 with a
  pinned lockfile, verify:p3.3 and public asset formatting coverage.
- Updated .env.example, README and the full learning guide with local/manual and
  future hosted setup, exact commands, limitations, debug and understanding work.

### Run/test: measured evidence

Runs occurred on 2026-10-17 in Asia/Calcutta; raw report times below are UTC.

```powershell
.\.venv\Scripts\python.exe scripts/verify-p3.py --task P3.3
.\.venv\Scripts\python.exe scripts/verify-p1.py
.\.venv\Scripts\python.exe scripts/verify-p2.py --backend compose
```

- P3.3 run_at 2026-10-16T18:36:45.088662+00:00: PASSED. 58 API tests passed,
  zero failed/skipped, including real PostgreSQL user/login/role/reset/disable and
  atomic shared-counter tests. Project sentinel-p3-3-8cc23b93; report
  .artifacts/p3-3-verification.json.
- Covered salted password hashes, fixed parameter/input bounds, two-job work ceiling,
  unknown/wrong/disabled generic login errors and the password-reset race. JWT
  negatives include wrong secret, algorithm/type, issuer/audience, expiry, missing
  claims, malformed headers and stale token versions. JWT roles do not grant access.
- Real viewer reads returned 200 and incident writes 403; operator writes/transitions
  succeeded. Role changes affected existing tokens; reset/disable invalidated them;
  enable did not resurrect old tokens. Reserved action-approval guard rejects viewer.
- Runtime verifier created only its isolated random-password test operator through
  the stdin CLI, logged in and used its token. That same token, incidents and history
  survived API/database restarts. During DB outage, protected operations returned
  AUTH_UNAVAILABLE 503, health 200 and readiness 503. Test containers/network removed,
  volume preserved; no development user was created by verification.
- Runtime source hash including API public assets:
  bc4b467210f9ddc591635e10bea66f3c97c3f10920ad1c0596138c1b9fa80db0.
- Full P1 run_at 2026-10-16T18:38:21.178445+00:00: PASSED. 14 checkout and 27 payment
  tests, seven real-service scenarios and three 20-request k6 loads passed. Root npm
  test also ran 33 API fast tests; its DB suite was explicitly skipped there, separate
  from the 58-test real-DB run above. Existing Starlette/httpx warning remains.
- P2 Compose run_at 2026-10-16T18:41:01.015364+00:00: PASSED after rebuilding with
  the new workspace dependency/lockfile. 16 concurrent DB requests/one payment,
  eight HTTP replays, constraints/rollback/migration checks, restart persistence,
  version sequence 201 -> 504 -> 502 -> 201, four deployments/one ACTIVE. Report
  .artifacts/p2-compose-verification.json; test volume preserved.
- Final Prettier, Ruff lint/format, Python compilation, pip consistency and whitespace
  checks passed. Final runtime source matched the successful P3.3 report hash.

### Localhost preview and manual setup

No old Node API process was running at activation. Started scripts/api-local.py,
which preserved the existing development volume, added an ignored random JWT secret
and applied 003_users.sql. Verified login page HTTP 200 with CSP, readiness ready,
and protected incidents HTTP 401 without credentials. Development users count was
measured as zero: there is no automatic personal/default administrator.

Opened http://localhost:3000/auth-test in the in-app browser; confirmed the email and
hidden password fields, role-testing form and a real Services-button response of
401 before login. API/database remain running for the user. Successful personal
browser login is not claimed: the user's account setup is intentionally still pending.

Required manual step in the user's own interactive PowerShell terminal:

```powershell
Set-Location V:\sentinel\sentinel
.\.venv\Scripts\python.exe scripts/api-user.py create --email you@example.com --role ADMIN
```

Replace the example email; choose a unique 12-128 character password at the hidden
confirmation prompts. Do not send it in chat or pass it in command arguments.
Then log in on /auth-test. The Node stdin account tool was exercised by the verifier;
Codex did not populate the personal interactive password prompt.

Hosted manual work remains unperformed: approved provider/database provisioning,
migration 003 with a migration identity, shared secret-manager signing key, verified
DB TLS, initial admin bootstrap, HTTPS/ingress, trusted proxies/edge limits and host
memory sizing. The local CLI refuses remote DBs; no public route was exposed or fee
incurred. See the guide's ordered hosting steps and remaining feature limitations.

### Debug, understanding check and commit summary

The P3 guide explains 401/403/429/503, missing secrets/accounts, token expiry/reset,
hidden prompt requirements, file-by-file functions, async/error/control flow and
dependencies. It provides three comprehension questions and a viewer/read/write/
role-change exercise. Student mastery and local personal setup remain pending.
No MFA, refresh tokens, public signup or per-token logout revocation is claimed.

Commit: find with git log --grep="feat(P3.3): add login and role-based API authorization".
Use configured sole author without co-author trailers; commit/push to origin.
P3.4 requires its own explanation/approval before implementation.

## P3.4 task record

- Approval: user explicitly approved finishing all remaining P3 tasks. Personal
  local account setup was confirmed complete by the user; credentials omitted.
- Concepts, architecture, file walkthrough, commands, debugging, questions and
  independent exercise: see the P3.4 section of P3-LEARNING-GUIDE.md.
- Implementation: PostgreSQL investigation/outbox/event transaction, Redis/BullMQ
  worker, three bounded attempts, fenced database leases, authenticated enqueue,
  idempotency and safe workflow-check result explicitly marking AI as not performed.
- Executed: `npm run verify:p3.4` equivalent Python verifier, TypeScript build,
  66 passing API/unit/database/queue tests with no skips; Ruff and Prettier checks.
- Actual runtime evidence: .artifacts/p3-4-verification.json, run started
  2026-10-16 19:07:35 UTC (2026-10-17 IST), status PASSED. Enqueue took 94 ms.
  API/database restart persistence, worker crash recovery, Redis AOF restart
  persistence and enqueue-during-Redis-outage/outbox recovery all passed.
- Negative checks: viewer writes rejected, invalid idempotency key rejected,
  publication failure retained outbox, stale worker completion rejected, repeated
  worker failure stopped after three attempts. No production commands were run.
- Manual setup: no additional manual setup required for local verification; the
  helper generates ignored Redis configuration. Hosted PostgreSQL, authenticated
  TLS Redis, API and a separate long-running worker remain unprovisioned. See guide
  for setup order and secret names. Public deployment requires separate approval.
- Learner explanation and independent exercise: pending student responses.
- Commit: `feat(P3.4): add durable investigation queue and worker` (this record).
- Next: P3.5, explicitly approved; P4 is not approved.

## P3.5 task record

- Approval: user explicitly approved finishing all P3 parts. P4 is not approved.
- Concept, architecture/data flow, file plan, approval checkpoint, implementation,
  function walkthrough, exact run/test commands, debugging, manual hosting setup,
  questions and independent exercise are in P3-LEARNING-GUIDE.md, P3.5 section.
- Added authenticated GET /api/v1/incidents/:id/stream, saved-event replay and
  Last-Event-ID resume. Events remain atomic with investigation state in migration
  004; no additional schema/dependency required. Browser Watch/Stop/history controls
  keep tokens and reconnect cursors in memory and display text rather than HTML.
- Security/resource bounds: READ permission, strict verified expiry, current-user
  recheck every five seconds, scoped cursors, query-parameter rejection, two streams
  per user/ten per API process, 60-second or 500-event rotation, bounded drain wait,
  50-event database batches, one-second polling and five browser connection attempts.
- Actual final P3.5 verification: .artifacts/p3-5-verification.json, run started
  2026-10-16 19:18:31 UTC (2026-10-17 IST), PASSED. 70 tests passed, zero skipped.
  Positive SSE checks: persisted CREATED, live investigation enqueue, ordered status
  replay from Last-Event-ID. Negative checks: anonymous401, invalid/wrong-scope
  cursor400, query-token400, third concurrent stream429, expired JWT401, active
  stream termination at expiry and disabled-account revocation.
- Cumulative runtime checks also passed: authenticated incidents, API/database
  restart history persistence, database-outage handling, worker crash recovery,
  Redis AOF restart persistence and Redis-outage outbox recovery. Enqueue110ms.
- Verifier correction: first P3.5 run passed 70 tests but an exact P3.4 conditional
  skipped standalone queue recovery. Corrected it and reran the full gate above;
  the final artifact includes all queue recovery flags. No skipped check is claimed
  as having run in the earlier invocation.
- P1 regression: scripts/verify-p1.py passed, seven real HTTP scenarios, all three
  20-iteration k6 scenarios, 14 checkout and 27 payment tests. Its generic npm API
  run intentionally skipped the database suite without test credentials; the separate
  P3.5 gate above ran the real PostgreSQL/Redis suite with zero skips. Existing
  FastAPI/httpx deprecation warning remains; no test failed.
- Local preview: helper applied only pending migration004, preserved existing service
  names and started API port3000 plus the workflow worker. Updated test page opened
  visibly in the in-app browser. Sign in with your existing account to Watch progress.
- Limitations: workflow check is not AI analysis or telemetry evidence; SSE is
  one-second database polling and bounds are per process. Hosted infrastructure,
  TLS ingress and public access have not been provisioned or tested. Full dashboard
  remains P9. Learner explanations/exercise remain pending student completion.
- Manual setup: no additional local setup required. Hosted PostgreSQL, TLS Redis,
  secret manager, migration job, API/worker hosting, HTTPS and SSE proxy setup are
  listed in the guide and require provider selection/deployment approval.
- Commit: feat(P3.5): stream persisted investigation progress with SSE (this record).
- Next phase: P4, awaiting separate explicit approval.

- Final P2 Compose regression: .artifacts/p2-compose-verification.json PASSED,
  run 2026-10-16 19:21:10 UTC. Sixteen concurrent requests created one payment;
  eight HTTP replays, constraint/rollback checks, migration checksum/replay,
  database restart persistence and four deployment records across
  payment-v1 -> payment-v2-timeout -> payment-v3-error -> payment-v1 passed.
- Final local readiness returned 200; read-only database check found the existing
  one user and one incident. No account recreation or personal credential access.
- Final formatting, Ruff checks and whitespace checks passed. Runtime source SHA256
  matched the final P3.5 verification artifact before commit.

## P3.5 follow-up: pre-P4 regression gate (2026-10-17)

- User requested verification through P3 before continuing to P4. Initial Docker
  verification failed because the Linux engine was stopped; started the installed
  Docker Desktop and reran successfully, without deleting volumes.
- Initial P1 workspace invocation exceeded its historical 60-second subprocess
  timeout during Docker startup and expanded P3 tests. Increased only the bounded
  workspace test-process deadline to 180 seconds; assertions and load thresholds
  remain unchanged. Retry passed all 14 checkout tests, 27 payment tests, seven
  real HTTP scenarios and three 20-iteration k6 scenarios.
- P3.5 verifier passed 70 tests with zero skips, plus API/database restart, worker
  crash recovery, Redis persistence and Redis-outage outbox recovery. Final artifact
  run 2026-10-17 08:39:56 UTC. P2 Compose verifier passed, run 08:41:45 UTC: 16 concurrent
  requests/one payment, 8 HTTP replays, persistence/checksum/rollback and deployment
  profile checks. Local API restored: health/ready/auth-test 200; anonymous protected
  services/incidents 401. Existing configuration/volumes preserved.
- Ruff formatting/checks passed for the timeout fix. Commit uses taskID P3.5.
- P4.1 concepts, data flow, proposed files, dependency choices, risks and acceptance
  tests explained. User explicitly answered Approve P4.1 after that explanation.
  P4.2-P4.5 remain subject to their own learning-first checkpoints.

## P4.1 task record

- Approval: after concepts, request/data flow, proposed files, risks and acceptance
  tests were explained, user explicitly selected Approve P4.1. Implementation began
  after P1, P2 Compose and P3.5 rechecks passed. P4.2 is not approved yet.
- Concepts/architecture/file plan/approval/implementation/walkthrough/run-test/debug/
  understanding check/commit summary: docs/P4-LEARNING-GUIDE.md, including exact
  commands and manual local/hosted setup. Learner exercise and responses pending.
- Added per-app registries, completed HTTP response counters and classic latency
  histograms in checkout and payment, exposed at GET /metrics. Bounded service,
  method, route and status labels; unmatched/OTHER fallbacks; no raw URLs, IDs or
  secret fields. Scrapes are excluded. Timers include request parsing and awaited
  dependencies. No database migration, API auth change or new secret required.
- Dependencies pinned: @prometheus-io/client 0.16.1 (current official Node package,
  renamed from prom-client; verified Node 24 support) and prometheus-client 0.26.0.
- Focused tests executed:16 checkout tests passed, 30 payment tests passed. New tests
  cover real HTTP/ASGI success/failure metrics, delays, unknown URLs/private markers,
  matching count/+Inf histogram bucket, scrape exclusion and per-app isolation.
  Node dependency-latency unit test explicitly uses a payment HTTP stub. Python
  payments remain simulated; no real financial transaction occurred.
- Updated real native verifier checks metrics in every scenario and passed all
  seven normal/fault scenarios and three 20-iteration k6 checks. Actual metric
  assertions parse real exported text from both running services, including
  checkout 502/504 and payment 503 responses; unavailable payment has no scrape.
  See .artifacts/p1-verification.json for individual counts and timestamps.
- Existing FastAPI/httpx TestClient deprecation warning remains; tests pass. Counters
  reset on process restart; collector history is P4.2. Aborted responses without a
  completed body are outside these completed-response metrics. Current Python
  collection supports one worker per service instance. Hosted metrics stay private.
- Manual setup: no additional setup required for local checked environment. Fresh
  clones install pinned npm/Python dependencies and use documented start commands.
  No hosted service has been provisioned. Provider/collector storage/retention,
  private routing/TLS and per-instance scrape setup remain future manual work.
- Planned commit: feat(P4.1): instrument checkout and payment HTTP metrics.

- Final P4.1 P2 Compose regression PASSED, run 2026-10-17 08:48:29 UTC,
  .artifacts/p2-compose-verification.json: rebuilt both services with pinned metrics
  clients; 16 concurrent requests created one payment; 8 HTTP replays, migration replay/
  checksum/rollback, restart persistence and deployment version faults all passed.
- Final native preview started supervised loopback services on 3001/3002 with explicit
  simulated memory-only payment storage. Demo checkout 201 and invalid request 422
  returned as expected. Both /metrics returned 200 with request/histogram samples;
  browser tabs opened visibly and confirmed real samples. API/worker on 3000 remain
  healthy, backed by the preserved P3 PostgreSQL/Redis configuration.
- Final Prettier, Ruff/check-format and whitespace checks passed. Existing warnings
  are documented above; no failed test is being presented as a pass.
- Commit summary: feat(P4.1): instrument checkout and payment HTTP metrics.
  Next task is P4.2 Prometheus scraping/PromQL, awaiting its learning checkpoint.

## P4.2 task record

- Approval: user approved the explained P4.2-P4.5 plan together. Full task concepts,
  architecture, file/function walkthrough, commands, debug notes, hosted setup,
  questions and independent exercise are in P4-LEARNING-GUIDE.md.
- Implemented pinned Prometheus3.15.0 with immutable digest, loopback9090, named
  volume,24h/256MB target retention and512MiB/one CPU bounds; two native service
  targets over Docker Desktop host bridge,2s scraping,1s deadline. Added annotated
  PromQL and owned-process supervisor/verifier. No database/schema changes.
- Actual scripts/verify-p4.py --task P4.2 PASSED against real processes and Docker:
  both targets up=1; real valid traffic produced saved samples; injected payment
  errors produced checkout502 and positive5xx rate; invalid query rejected;
  historical sample at original timestamp survived Prometheus restart. Evidence:
  .artifacts/observability/p4.2-verification.json. No metrics fabricated.
- Tests use simulated memory-only payment semantics, not real financial operations.
  Native demo listeners from the earlier owned preview were stopped by verified
  process identity before replacing them. API/database/worker were preserved.
- Manual setup: no additional local setup required. Hosted collector provisioning,
  private service discovery, TLS/authentication and durable retention remain pending.
- Learner responses/exercise pending. Commit: feat(P4.2): collect and verify
  Prometheus service metrics. Next P4.3 is already approved.

## P4.3 task record

- Approved in combined P4 plan. Concepts, files/functions, flow, exact commands,
  positive/negative tests, debug, hosted manual steps and exercises: P4 guide.
- Added pinned/digest-verified Loki3.7.8 and Alloy1.20.1, bounded resources,
  persistent Loki/Alloy positions volumes,24h log retention and read-only mount
  of only the two owned demo log files. No Docker socket mounted.
- Actual P4.3 verifier PASSED: real latency fault caused checkout504; a fresh
  request-ID/status LogQL filter found its JSON completion log. Labels contained
  filename/service/service_name, no request_id. Invalid LogQL rejected.
- Initial run timed out because repeated identical counter values across process
  restarts hid growth in the P4.2 rate fixture. Fixed fixture to wait for the first
  error scrape before additional requests; full rerun passed. Loki startup readiness
  was also allowed to settle. Evidence: .artifacts/observability/p4.3-verification.json.
- Manual setup: no additional local setup required. Hosted scoped file collection,
  rotation, storage/retention, tenant authentication/TLS remain unprovisioned. Local
  loopback unauthenticated Loki must not be made public. Learner exercise pending.
- Commit: feat(P4.3): collect demo JSON logs with Alloy and Loki. P4.4 is approved.

## P4.4 task record

- Approved in combined P4 plan. Full teaching/walkthrough/commands/risks/manual
  hosting setup, questions and exercise: P4 guide P4.4 section.
- Added optional explicit OpenTelemetry server/client/server spans across real
  checkout/payment HTTP, service resources, bounded batch queues/deadlines and
  trace-ID log correlation. Checkout creates a fresh ingress root; only internal
  traceparent propagates, no baggage/bodies/query strings/credentials.
- Pinned SDK/exporter dependencies and Tempo3.1.0 by digest; private loopback query/
  OTLP ports, named trace volume,24h backend-worker retention. Tempo3 monolithic
  config uses supported backend_worker rather than removed2.x compactor fields.
- Actual P4.4 verifier PASSED: connected trace with both services, three spans and
  parent links; malformed ingress context handled; checkout201 during stopped Tempo,
  then Tempo restarted. Prior scrape/history/real-Loki-timeout gates also passed.
  Evidence .artifacts/observability/p4.4-verification.json. No fabricated traces.
- Python focused tracing tests 2 passed, verifying valid parent IDs, malformed-context
  fresh root and remote/credentialed export destination rejection. Full service
  regressions run before commit; current native guard permits only the fixed local
  receiver. Hosted authenticatedTLS export remains a separately configured future
  extension. No additional local manual setup required. Learner exercise pending.
- Commit: feat(P4.4): trace checkout to payment with OpenTelemetry and Tempo.
  Next P4.5 is approved; no P5 work authorized.

## P4.5 task record (verification in progress)

- Approval: user approved all remaining P4.2-P4.5 after the combined explanation,
  including authenticated ingestion and the new migration. Every required teaching
  section, file/function walkthrough, commands, debug notes, manual hosted setup,
  comprehension questions and independent exercise is in P4-LEARNING-GUIDE.md.
- Added sustained-error rule, grouping/repeat Alertmanager receiver with a distinct
  read-only credential file, migration005 alert episode receipts and fixed-service
  webhook ingestion. Atomic advisory-lock transaction creates one incident/CREATED
  event/receipt; repeats reuse incident; resolved-first/late firing cannot fabricate
  or resurrect an incident. Signal resolution never auto-resolves incident status.
- Auth before bounded 64 KiB JSON parsing, fixed alert/service/version/receiver,
  bounded batch/timestamps, two concurrent operations/process and sanitized errors.
  No annotation/groupKey/externalURL can select SQL, fetch targets or commands.
  Helper generates/preserves ignored separate webhook key and strips it from workers.
- Real cumulative API/database/queue/SSE/alert suite75 tests passed with zero skips.
  Tests cover concurrent deduplication, event failure rollback, resolved-first/stale
  notification, invalid/unsupported/truncated input, missing/wrong credentials and
  ordinary user-auth separation. P3 runtime restart/outage/recovery gates passed.
- Local pending migration005 applied without replacing users/incidents. Startup
  then exposed a helper secret-stripping call error; corrected two separate dict.pop
  calls and successfully started API/worker. No configuration values were printed.
- promtool checked current Prometheus config/rule successfully; amtool checked the
  actual Alertmanager receiver config successfully. Live end-to-end verification is
  required in addition to these/API tests; outcome recorded below when complete.
- Live test corrections: healthy request exceeded the overly tight 200 ms demo
  deadline during collector load; supervisor now uses 1 s deadline/2.5s injected
  latency. Assertions/alert thresholds were preserved. First repeat check was too
  early; now sustains real fault while awaiting a bounded real notification repeat.
- Manual setup: no additional local manual setup required. All hosted provider,
  storage, TLS, secret rotation and ingress/SLO threshold work remains unprovisioned,
  listed by task in the guide. Learner answers/exercises remain pending.

### P4.5 live acceptance evidence

- Final real P4.5 pipeline verification PASSED, run 2026-10-17 09:45:39 UTC
  (15:15:39 IST). Artifact: .artifacts/observability/p4.5-verification.json.
- Two healthy scrape targets, actual fault error rate, malformed PromQL rejection,
  sample retention across Prometheus restart, fresh real Loki timeout, bounded Loki
  labels, connected cross-language trace and stopped-Tempo checkout success passed.
- Sustained real local fault -> Prometheus rule -> Alertmanager -> authenticated
  webhook -> PostgreSQL produced exactly one new grouped incident in the measured
  episode. Real repeat notifications were delivered/deduplicated. Recovery recorded
  signal resolved while incident remained OPEN. One inspected episode had 4 receipts.
- Failed attempts remain honestly documented above; later PASS does not erase them.
  Verifiers restore normal traffic/stop only owned children; collector volumes are
  retained. Independent fault episodes/test retries can retain multiple demo
  incidents overall; the guarantee is one incident per canonical episode, not one
  incident in the entire database. No user record was deleted or recreated.

### P4 final regression, preview and commit summary

- Final P1 verifier PASSED, run 2026-10-17 09:48:24 UTC: 17 checkout tests, 32 payment
  tests, seven real HTTP fault scenarios and three 20-iteration k6 checks. The generic
  npm API test invocation skips database tests without dedicated credentials; the
  separate 75-test real PostgreSQL/Redis gate above ran with zero skips. Existing
  FastAPI/httpx TestClient deprecation warning is documented, not hidden.
- Final P2 Compose verifier PASSED, run 09:49:13 UTC: rebuilt services with pinned
  metrics/tracing dependencies, 16 concurrent requests/one payment, 8 HTTP replays,
  constraints/rollback, migration replay/checksum, restart persistence and four
  version deployment records. Evidence: .artifacts/p2-compose-verification.json.
- Final API source and dependency lock hash matches the real 75-test verification
  artifact. Prettier, Ruff, official promtool/amtool config checks and whitespace
  checks passed. Supervisor restored healthy memory-only demo; main API/worker and
  persistent databases remain separate. Prometheus/Alertmanager opened visibly in
  browser, with per-task collector endpoints documented. Personal account preserved.
- P4.2 commit 4ed8813 (follow-up import cleanup ae2ea15); P4.3 cecff0e;
  P4.4 ae5eeb1; P4.5 feat(P4.5): ingest authenticated grouped alerts without duplicate
  incidents (this record's commit). Each uses the configured sole author, no trailers.
- No manual local setup required. Hosted/public access, private authenticatedTLS
  ingestion/storage, provider accounts/costs, retention and production threshold
  selection remain unprovisioned and task-by-task manual steps are in the guide.
- Student explanations and independent exercises remain pending. P5 is not approved.

## P5.1 task record

- Approved with P5.1–P5.5 after the expanded explanation.
- Implemented typed, fixed-template read-only Prometheus evidence; see P5-LEARNING-GUIDE.md.
- Measured: 4 fixture tests passed; live local Prometheus returned request-rate samples; unavailable endpoint returned UNAVAILABLE. Ruff passed.
- Live testing caught Prometheus timestamp precision rounding; query boundaries now round inward to whole seconds. No source timestamp outside the requested window is accepted.
- Manual: existing P4 collectors required locally; hosted monitoring remains unprovisioned.
- Learner questions/exercise remain open; proceeding within explicit all-P5 approval.

## P5.2 task record

- Implemented fixed-selector log search, capped records/samples, retrieved-set counts and explicit truncation; approved with all P5.
- Six cumulative fixture tests passed; live metrics/logs plus unreachable source checks passed. Ruff passed.
- Documentation: P5-LEARNING-GUIDE.md P5.2. Hosted log provisioning remains manual; learner exercise remains open.

## P5.3 task record

- Added async bounded deployment reader, SELECT-only local identity and ignored config; preserved existing migrations.
- Ten cumulative fixture tests passed. Real isolated PostgreSQL synthetic release read and EMPTY checks passed; DELETE, payment-table reads and DDL denied.
- Real Windows test caught incompatible default async loop; verifier now selects Windows selector loop, also required by the engine launcher.
- Local demo DB started on 55432, existing P2 migrations applied, reader provisioned. No real releases fabricated; hosted setup remains pending.

## P5.4 task record

- Implemented pure adjacent-window means, coverage and explicit missing/zero-baseline semantics. Approved with all P5.
- Fourteen cumulative fixture tests passed; Ruff passed. No causal or AI claim made.
- Manual setup: none. Learner questions and independent exercise remain in P5-LEARNING-GUIDE.md.

## P5.5 task record

- Approval: explicit all-P5 implementation request after expanded explanation.
- Added authenticated internal Python collection, additive API migration 006,
  four bounded canonical SHA-256 snapshots, append-only mutation protection,
  fenced atomic completion/event/outbox persistence, READ history pagination and
  localhost evidence inspection controls.
- Local launcher separates engine/worker/API credentials and preserves accounts,
  incidents, volumes and empty real release history. Worker mode is now
  deterministic-evidence; legacy unconfigured P3 mode remains explicit.
- Final measured run: 83 API tests passed, zero failures/skips with real PG/Redis,
  collector and BullMQ; includes wrong collector key -> FAILED/no snapshots,
  expired/replacement lease fencing, rollback, exact HTTP replay after API rebuild,
  hash checks, existing auth/SSE/alert contracts. Runtime restart/outage checks passed.
- Engine 16 tests passed; deployment reader real DB permissions passed; checkout
  17 and payment 32 regressions passed. Payment's existing TestClient deprecation
  warning remains; no failures. Ruff/format and final live P5 checks are recorded
  in the completion record below.
- Real integration caught PostgreSQL JSONB parameter inference reformatting canonical
  bytes; fixed by casting the shared parameter to text first. Subsequent hash
  round-trips passed. No old migration was edited.
- Documentation: P5-LEARNING-GUIDE.md, MANUAL-SETUP.md, HOSTED-SETUP.md and README.
  Hosted guide researched official Neon/Render docs, provides exact account/database
  setup and grants, and lists binding/private transport/bootstrap/collector auth
  work still required before public deployment. No hosted resource provisioned.
- Learner checkpoints remain open. P5 software complete after final checks;
  P6 implementation is not authorized.

### P5 final completion checks

- Final live Prometheus/Loki positive and unreachable-source checks passed again.
- Ruff check and format check passed for all new engine/helper/verifier files;
  repository Prettier check and git diff whitespace check passed.
- `.env`, `.env.api` and `.env.evidence` are all Git-ignored. Example values are fake.
- Current local preview is open at http://localhost:3000/auth-test with Saved
  evidence controls; API/engine are loopback-only. Existing local credentials
  were preserved and were not entered/read by the agent.
- P3 runtime restart tests deliberately use workflow-check compatibility mode;
  the same run's real database tests separately exercise the live P5 collector,
  evidence worker and wrong-key failure path. The report labels that optional gate.
- P5 software is verified. Hosted provisioning/public deployment and learner
  explanations remain outstanding; proceed to no later phase without approval.

## P6.1 task record

- Approved after explanation; remaining P6.2-P6.5 separately approved together.
- Added strict hypothesis/citation schema and optional loopback Ollama adapter; disabled by default, no remote calls or model installation.
- 25 cumulative engine tests passed, including malformed/oversized output, unknown citations, unavailable and timeout paths. Ruff passed.
- Fixtures are not live AI accuracy measurements. Manual model/cloud setup can wait. See P6-LEARNING-GUIDE.md for walkthrough and learner checks.

## P6.2 task record

- Added explicit sequential stages, guarded fixed tools, exact scalar fact provenance and partial-state handling under combined P6 approval.
- 28 cumulative engine tests passed. Live sequential workflow passed against local collectors/reader with model disabled; no fabricated zero/deployment claims.
- No cloud/model setup required for this path. See P6 guide and .artifacts/p6-workflow-verification.json.

## P6.3 task record

- Added pinned LangGraph 1.2.16 parallel source nodes, explicit join and bounded analysis; engine uses the graph with the P5 response contract preserved.
- 30 engine tests passed; real sequential and parallel local workflows passed. pip check passed; existing dependency versions constrained, full engine runtime closure pinned.
- No hosted tracing/model call; graph memory is not represented as durable checkpoints. PG/queue remain the recovery boundary.
- Manual: install engine requirements on future restarts/deployments; cloud setup can wait. See P6 guide.

## P6.4 task record

- Explicit combined approval covered graph, reports and migration 007.
- Added deterministic ranked hypotheses, guarded model ranking, contradictions,
  abstention, exact scalar citations, immutable canonical reports and authenticated
  READ inspection. Facts bind to snapshot UUID/hash; report reads verify report,
  snapshot hashes and exact referenced values. Unsupported categories/mislabeled
  measurements are rejected at the backend boundary.
- Report, four snapshots, terminal event/result and outbox cleanup commit atomically
  under the current lease. Evidence jobs have 30-second leases and 17-second work
  budgets; graph/model deadlines are 12/eight seconds. Legacy limits remain intact.
- Final real PG/Redis/API run: 88 tests passed, zero failed/skipped, including live
  Python collector/BullMQ report persistence, rollback, immutable rows, anonymous
  rejection, viewer reads, API reconstruction and existing auth/alerts/SSE.
  API/DB/Redis restart and outage/recovery runtime checks passed.
- P6.4-specific engine suite: 34 tests passed (P6.5 evaluation test excluded);
  current cumulative suite including the pending evaluation test passed 35.
- Optional model remains disabled; local configuration requires confirmation that
  Ollama cloud routing is disabled. Cloud-labelled tags/remote URLs are rejected.
  No real model installed/called. Graph tracing explicitly disabled.
- Updated local/manual/hosted instructions and fake .env.example variables. Hosted
  runtime grants need SELECT/INSERT on investigation_reports after migration 007.
  Cloud and real-model setup remain deferred by user preference.

## P6.5 task record and phase completion

- Implemented ten versioned synthetic labelled scenarios and an evaluator using
  the same graph/calculations/synthesis as the app. Ground truth is withheld from
  model inputs. Separate deployment/nondeployment/no-cause cohorts and exact
  denominators are reported, along with requested/validated model-call statuses.
- Measured deterministic baseline: top-1 6/7, top-2 7/7, candidate precision 7/13,
  false deployment attribution 1/6, no-cause abstention 3/3, citation validity 18/18.
  Model disabled on all ten cases. The coincident-release/dependency scenario
  deliberately exposes an incorrect deployment rank; valid citations do not prove
  causation. These are not live AI or real-world performance claims.
- Final engine suite: 35 passed. Final API/real PostgreSQL/Redis suite: 88 passed,
  zero skips, including live local collector/worker/report integration and existing
  auth/incident/queue/alert/SSE checks. Runtime API/DB/Redis outage/restart checks
  passed. Checkout 17 and payment 32 regressions passed after graph dependencies.
- Live sequential/parallel source verifier passed. P6 preview restarted on final
  source; API, engine, Prometheus and Loki health/readiness returned 200. Anonymous
  collector POST returned 401. Localhost page visibly includes Hypothesis report
  and Saved evidence controls; no passwords were entered/read by the agent.
- Repository Prettier, Python Ruff/check/format, pip check and diff whitespace checks
  passed. .env/.env.api/.env.evidence remain ignored. Added npm test:engine,
  verify:p6 and evaluate:p6 commands and included scenario JSON in formatting.
- Documentation: complete task-by-task P6 guide, tracked P6-EVALUATION.md with
  measured limitations, updated README and manual/hosted steps. Optional local
  model setup and cloud provisioning are deferred at user request; no model was
  installed/called, no remote evidence sent and no external deployment occurred.
- P6.1 937a705; P6.2 b65d605; P6.3 264c87a; P6.4 14c4a61; P6.5 is this record's
  feat(P6.5) commit. Sole configured account author; no co-author trailers.
- P6 software/fixture acceptance complete. Live model quality, live model latency,
  public hosting and learner comprehension checkpoints remain explicitly open.
  P7 has not been started or approved.

## P7.1 task record

- User approved P7.1-P7.4 after the complete learning-first plan, including local embedding download and isolated pgvector storage.
- Authored ten tailored runbooks and two explicitly fictional postmortems. Added versioned manifest and bounded, safe-path/metadata/required-section validator.
- 40 cumulative engine tests passed; invalid/duplicate/traversal/missing-section/unlabelled-example cases rejected. No database/model call in this task.
- P7 guide includes walkthrough, commands, debugging, learner questions/exercise. Manual setup: none. No remediation authorized by document content.

## P7.2 task record

- Approval: included in the user's complete P7 approval; separate development DB
  and local model-artifact download authorized. No cloud resource provisioned.
- Implementation: deterministic section chunks, exact Unicode offsets, immutable
  source versions, fixed-model normalized vectors, pinned CPU embedding artifacts,
  separate digest-pinned pgvector DB/volume and SELECT-only reader.
- Measured: first real local ingestion stored 12 documents and 72 chunks. The
  real isolated verifier checked replay zero, same-version mutation rejection,
  retained version 1 after publishing version 2, and reader write denial.
  Local model query returned 384 dimensions; artifact hashes and pip check passed.
  Chunk/vector/catalog tests passed in the 43-test engine run.
- Download recovery: Docker Desktop's image transfer stalled. Downloaded the same
  OCI objects directly, checked every SHA-256, and imported the exact pinned
  image; Docker reported the expected repository digest. No Docker settings,
  existing DB images or persistent volumes were changed.
- Learning/manual instructions: see P7-LEARNING-GUIDE P7.2; cloud setup deferred.

## P7.3 task record

- Implementation: fixed category queries, service/latest-version/model filters,
  exact cosine top-3 retrieval and explicit OK/EMPTY/DISABLED/UNAVAILABLE states.
  A maximum of two five-second killable children protects native inference work.
- Backend: independently validates exact reviewed source/version/passage/range/hash;
  migration 008 persists immutable context in the existing fenced transaction.
  Authenticated report reads preserve the stored text; old reports return null.
- Actual results: 90 API tests, zero skips/failures, with real PostgreSQL/Redis.
  Repeated with TEST_KNOWLEDGE_REQUIRED=1 against the restarted real collector:
  worker stored real retrieved context, hash verification and store replay passed.
  Invalid context rolled back snapshots/report/completion; UPDATE/DELETE denied.
- Live collection: real local sources plus three actual embedding-retrieved
  passages returned in 4.67 seconds; the TypeScript backend accepted all exact
  passages. No chat model inference or remediation performed.
- Local API restarted with migration 008 and reader-only knowledge configuration;
  localhost auth-test opened with the new report/citations button. Existing login
  credentials untouched. Full hosted/manual instructions recorded separately.

## P7.4 task record

- Added reproducible real pgvector/CPU embedding verifier with owned disposable
  DB cleanup. Positive tests cover 12 documents/72 chunks, five category searches,
  exact source passages, replay and retained/latest versions. Negative tests cover
  same-version changes, mixed model identity, token overflow and reader write
  denial even after disabling its read-only transaction setting.
- Relevance finding: initial 0.5 threshold returned irrelevant passages for two
  off-topic queries with incidental domain terms (scores 0.543-0.598). Shared
  engine/backend minimum raised to 0.65; both now abstain while all five curated
  queries retain expected top sources. Two additional lexical-guard abstentions
  pass. This is small-set calibration, not general retrieval accuracy.
- Injection: actually embedded/retrieved a synthetic malicious version only in
  the disposable DB; no action was performed. Separate engine-boundary tests
  show malicious retrieved text cannot alter hypotheses or become executable
  fields. Backend forged/action-bearing citations are rejected. HTML rendering
  remains textContent. No chat-model attack-resistance claim is made.
- Actual verification: engine 46 passed; API 90 passed with zero skips and live
  context required; payment 32 passed; checkout 17 passed. Real retrieval/version/
  privileges/injection checks passed; Ruff, Python format, Prettier and pip check
  passed. A real unreachable knowledge DB returned UNAVAILABLE in 4.86 seconds.
  Main API, engine, checkout, payment and Prometheus returned HTTP 200 readiness.
- One intermediate verifier run failed due to an undefined fixture variable;
  corrected and rerun successfully before completion. This did not modify the
  development catalog or primary data. Test-only databases were cleaned up.
- Documentation: full task-by-task P7 concepts/flow/files/walkthrough/tests/debug/
  questions/exercises, README and ordered local/hosted manual setup instructions.
  Config secrets and model weights are ignored. Cloud setup remains deferred;
  no paid resources, public deployment, chat inference or remediation performed.
- Commits pushed separately under the configured sole author: P7.1 28de0c8,
  P7.2 c06c818, P7.3 49065dc; P7.4 uses the descriptive task-labelled commit below.

## P8.1 task record

- Full P8 approval received, including isolated local rollback tests.
- Added exact proposal parser, fixed action/sandbox policy and non-executing dry
  run. Positive/negative policy checks passed; API TypeScript build passed.
- Synthetic identities only in these tests; no Docker operation performed.
- Concepts, walkthrough, debugging, learner questions/exercise and manual setup
  recorded in P8-LEARNING-GUIDE.md. No manual setup required for this task.

## P8.2 task record

- Added migration 009, immutable proposal identity/audit, one-active-sandbox index,
  atomic approve/reject and ten-minute expiry with idempotent decision replay.
- Authenticated routes enforce WRITE_INCIDENT/APPROVE_ACTION; repository checks
  live roles again. Incident history/SSE accepts validated remediation events.
- Actual verification: 94 API tests passed, zero skips; real PostgreSQL/Redis,
  concurrent replay/approval, permission revocation, mutation denial and old
  functionality. Full restart/outage verifier reports PASSED.
- Initial test fixture used createUser's UUID return as an object; fixed before
  passing tests. No Docker mutation occurred in this task. Full walkthrough and
  manual requirements recorded in P8-LEARNING-GUIDE.md.

## P8.3 task record

- Separate memory-only Docker sandbox on loopback 4301/4302; good-image checkout
  baseline verified before deliberately introducing payment-v3-error. Existing
  demo/API databases and service processes are not mutation targets.
- Independent executor uses fixed local Docker context/project/file/argument arrays,
  exact container/image checks, live approval/role/token/incident/expiry rechecks,
  committed execution token, fenced completion, no blind retries and a shared
  setup/executor file lock. Durable approved work supports explicit one-shot/watch.
- Actual real scenario PASSED: test-only HTTP login/RBAC and PostgreSQL ADMIN
  approval; real faulty-to-payment-v1 container replacement; three successful
  checkouts; immutable target/runtime match; duplicate execution NO_EXECUTION;
  audit PENDING/APPROVED/EXECUTING/VERIFIED; incident remains OPEN.
- Four synthetic executor boundary tests passed. API TypeScript build and Python
  lint passed. Temporary verification DB removed; sandbox retained.
- Corrected invalid deployment marker to a UUID and fixed test auth-key type.
  Replaced blocking test subprocess with async execution after a stale HTTP
  keep-alive socket reset; accepted full scenario reran successfully.
- Runtime restoration: Docker had stopped during session interruption. Retained
  API/demo/knowledge and observability services restarted; migration 009 applied.
  No volumes/data reset. P8 guide records files, async/error paths, tests, debug,
  comprehension exercises, Docker privilege boundary and manual launch commands.

## P8.4 task record

- Added conservative recovery classifier, exact response validation, bounded
  16 KiB HTTP responses, three checkout samples spaced one second apart, >=2s
  verification window and stable target container/image across that window.
- Actual Docker/HTTP scenario passed: 3/3 checkouts over 2.781s, correct image/
  version/readiness, VERIFIED audit and duplicate NO_EXECUTION; incident OPEN.
- Six Python boundary/recovery tests passed, including conclusive failed command
  -> FAILED and uncertain timeout -> UNVERIFIED, with no retries. Partial/invalid
  observations cannot produce VERIFIED. Failed persistence leaves reviewable
  EXECUTING, not a blind retry. Manual reconcile does not mutate Docker.
- Full learning walkthrough, result meaning, limits, exact commands, debug,
  learner questions/exercise and manual setup recorded in P8 guide.

## P7.3 follow-up during P8 regression

- Required-live API check initially failed because knowledge returned UNAVAILABLE.
  Diagnosis using the engine's exact interpreter/environment measured a successful
  local child at 5.58s, beyond the original 5s cold-start budget. No citation or
  authority validation was weakened.
- Raised killable retrieval to 8s, collector to 24s and worker to 27s within the
  existing 30s DB lease. Two-child cap, read-only SQL, no retries and explicit
  failure statuses remain. Updated the timeout boundary fixture and P7 guide.
- Actual verification: 46 engine tests passed; serial real API/PG/Redis run passed
  95 tests, zero skips, with TEST_KNOWLEDGE_REQUIRED=1 and real context persisted.
  This is a measured local reliability fix, not a claim that all hardware fits.

## P8.5 task record

- Added local dry-run/proposal/review/ADMIN decision/audit controls with text-only
  rendering and backend-authoritative permissions. Existing user credentials and
  roles were not read or changed. Browser opened localhost and reported no JS
  errors; authenticated approval tests use disposable test-only accounts.
- Added threat model and residual trust limits: native OS account/Docker sharing,
  trusted DB/API/executor hosts, dispatch-time revocation limit, finite recovery
  window and local-only process fencing. No production/cloud executor claim.
- Migration 010 adds decision/start links and immutable decision/execution tokens
  without editing applied 009. Public responses hide internal fencing/version
  fields. Verified session version/expiry is rechecked under the live user lock
  inside proposal/decision transactions; reset/expiry races fail closed.
- Executor checks both sandbox services' identity/ports/network/hardening, uses
  consistent project lock ordering, records automatic events with null actor_id
  (approving human remains decided_by), and invalidates matching stale registry
  bindings after terminal attempts. Abandoned attempts never repeat a mutation.
- Final actual API regression: 95 passed, zero skips/failures, real PostgreSQL/
  Redis/live P7 retrieval required, including migrations through 010, auth/SSE,
  audit rollback, concurrent approval, expiry and session-version checks. Full
  API/DB/Redis restart and outage verifier reports PASSED.
- Final real Docker/HTTP security scenario PASSED: faulty sandbox -> exact v1;
  readiness/version/image correct; 3/3 synthetic checkouts over 2.672s; exactly
  one competing executor verified; duplicate NO_EXECUTION; incident remains OPEN.
  Revoked role, disabled account, token reset, expired approval, changed binding,
  forged viewer approval and stale container blocked. Abandoned execution
  reconciled UNVERIFIED without mutation; token replacement rejected. All outside
  container IDs/images/states remained unchanged. Temporary API DB removed.
- Other actual checks: engine 46 passed; payment 32 passed; checkout 17 passed;
  executor/security/recovery unit fixtures 9 passed. Python lint/format, Prettier
  and pip compatibility checked. Secrets/local manifests/model weights ignored.
- Test development failures (fixture types/imports and blocking HTTP test process)
  were corrected before accepted reruns. A real P7 cold-start budget regression
  was diagnosed/fixed separately as 4d3d7fd; tests were not weakened to accept it.
- Task-by-task walkthroughs, exact commands, debug, comprehension questions and
  exercises in P8 guide; full local ADMIN/executor/manual/cloud responsibilities
  in MANUAL-SETUP/HOSTED-SETUP. No cloud setup is required to continue locally.
- P8 commits: P8.1 f117d45; P8.2 f4dd6cb; P8.3 04c660e; P8.4 127cb5a;
  P8.5 uses the final task-labelled security/documentation commit. All pushed
  under the configured sole author, without co-author trailers.

- Final runtime handoff: API/worker/engine restarted with current code/migrations;
  main API, engine, checkout, payment and Prometheus returned HTTP 200. Anonymous
  action read returned 401. A fresh separate payment-v3-error sandbox was prepared
  for interactive testing and its private approval-only watcher started. This
  deliberately faulty training sandbox does not alter the healthy monitored demo.
  Localhost page remains open; your own ADMIN choice is the remaining interactive
  account step. Startup/shutdown/reconcile commands are in MANUAL-SETUP.

## P3.5 follow-up: PARTIAL history/SSE reader repair (2026-10-18)

- Approval: user explicitly approved after explanation and reproduction.
- Cause: the worker persisted a valid PARTIAL terminal event, but readEvent's
  event-name allowlist omitted PARTIAL. Both HTTP history and SSE rejected the
  saved event and the repository returned sanitized DATABASE_UNAVAILABLE.
- Changes: add the missing name; add positive/negative stored-row coverage and
  real PostgreSQL/HTTP/live-SSE/reconnect regression coverage; document the flow,
  failure, safe recovery and learner checks in P3-LEARNING-GUIDE.md.
- Before fix: the targeted PARTIAL regression failed with Invalid stored incident
  event. After fix: all 97 cumulative API tests passed, zero failures/skips.
- Full verification: `TEST_KNOWLEDGE_REQUIRED=1` with
  `scripts/verify-p3.py --task P3.5 --with-evidence` PASSED. Real evidence collection,
  HTTP contracts, persisted history, API/database restart, worker crash recovery,
  and Redis outage/restart checks passed. Test containers removed, volumes kept.
  Evidence: ignored `.artifacts/p3-5-verification.json`, project p3-5-c9c277b1.
- Local recovery: restarted only the owned API supervisor processes. Main API
  readiness returned ready. The fixed repository reader loaded all four events
  of the learner's existing incident, including sequence 10 PARTIAL. No incident,
  investigation, account or database volume was deleted or rewritten.
- Manual action: no setup changes. Use Load history page and Watch progress again;
  sign in again if the token expired. No investigation rerun is required.
- No hosted deployment or remediation was performed; learner answers remain open.
- Commit: `fix(P3.5): preserve history and streaming for partial investigations`.

## P5.3 follow-up: Windows async deployment reader (2026-10-18)

- Approval: user approved the explicit Uvicorn Windows loop-factory repair after
  diagnosis and explanation. No new phase or hosted action is included.
- Cause reproduced: global policy produced WindowsSelectorEventLoop, but Uvicorn
  0.54.0's default factory produced ProactorEventLoop. Psycopg async raised
  InterfaceError on that loop; the collector correctly hid details as UNAVAILABLE.
- Changes: explicitly choose asyncio:SelectorEventLoop on Windows, preserve auto
  elsewhere; add startup/factory and reader success/failure unit regressions.
  File/function flow, commands, debugging and learner exercise are in P5 guide.
- Before fix: Windows startup regression failed; non-Windows branch passed.
- After fix: 50 engine tests passed; pip check found no broken requirements.
  Reader mocks verify read-only/query deadline configuration and safe failures;
  the non-Windows selection check is simulated, not a Linux execution claim.
- Live verification: controlled restart of the owned API/worker/engine supervisor;
  authenticated /collect HTTP 200, actual deployment reader EMPTY with zero matching
  releases, API /ready 200 and engine /health 200. Earlier live collection returned
  UNAVAILABLE. Prometheus/Loki/calculations remain PARTIAL for their existing
  traffic/coverage/truncation limitations, unrelated to this repair.
- No saved investigation/account/volume was deleted or rewritten. No investigation
  was enqueued. No new manual setup is required; old snapshots remain immutable.
- Commit: `fix(P5.3): select compatible Windows loop for deployment evidence`.

## Cumulative local recheck after P3.5/P5.3 fixes (2026-10-18; resumed 2026-10-19 IST)

- Authorization: user requested remaining tests, then asked to continue after an
  interruption. No new feature implementation, hosted deployment or real payment
  was authorized or performed.
- Unit suites actually run: checkout 17 passed; payment 32 passed; engine 50
  passed; executor/security 9 passed. These are separate suites, not a claim that
  every earlier phase's standalone load/container verifier was rerun.
- Cumulative API verification: 97 passed, zero skipped/failed, with real isolated
  PostgreSQL/Redis, TEST_KNOWLEDGE_REQUIRED=1 and --with-evidence. Full P3.5 verifier
  exited successfully, including HTTP auth/RBAC, live evidence persistence,
  PARTIAL history/SSE/reconnect, API/database restart, worker crash recovery and
  Redis outage/outbox recovery. Project sentinel-p3-5-70edfb51 test containers
  removed; volumes retained. Evidence: .artifacts/p3-5-verification.json.
- P5 live metrics/logs and unreachable-source checks passed. Isolated PostgreSQL
  deployment-reader tests read an explicitly synthetic verified release, returned
  EMPTY for another service, and denied DELETE, payment SELECT and CREATE TABLE.
  Test database/role cleanup completed.
- P6 live sequential/parallel workflows passed with model DISABLED. Ten synthetic
  evaluation scenarios completed: labelled top-1 6/7, top-2 7/7, candidate precision
  7/13, false deployment attribution 1/6, citation validity 1.0. These small
  hand-authored fixtures are not measured real-world or chat-model quality.
- P7 real CPU embeddings/pgvector verification passed: 12 documents/72 chunks,
  replay no-op, version integrity/history, reader write denial, irrelevant-query
  abstention, overflow/profile rejection and injection treated as source data.
  Its disposable database was removed. See .artifacts/p7-knowledge-verification.json.
- P8 interruption: the child scenario saved a PASSED artifact on 2026-10-18:
  actual HTTP login/RBAC/decisions, VERIFIED image/version/readiness and 3/3
  synthetic checkouts over 3.016 seconds; duplicate NO_EXECUTION; one concurrent
  attempt verified; revocation/disable/reset/expiry/forged approval/stale binding
  checks; abandoned attempt reconciled without mutation; token immutable; incident
  not auto-resolved. Artifact: .artifacts/p8-sandbox-verification.json. The outer
  wrapper's final cleanup and outside-container assertion were not captured, so
  full P8 wrapper completion is NOT claimed for this interrupted run.
- Resume on 2026-10-19: no verifier/executor process found, API port refused
  connections, Docker Linux engine pipe absent. Docker Desktop launch attempted;
  backend log reports Secrets Engine startup failure accessing/renaming its local
  engine.sock. No reset, volume deletion, secret/socket modification, WSL reset
  or production action was performed. P8 final rerun/cleanup check and restoring
  live services remain pending Docker recovery.
- Manual recovery: Quit Docker Desktop's error dialog and reopen it; do not use
  Reset to factory defaults. Once docker info succeeds, inspect retained state,
  restore local dependencies, rerun scripts/verify-p8.py through its final success
  line and check no disposable verification DB remains. Public hosting, optional
  chat-model testing and learner comprehension checks remain unperformed.

## P8.5 recheck completion and local restoration (2026-10-19 IST)

- Resumed the user's authorized remaining tests. Docker Desktop was closed;
  normal launch eventually restored its Linux engine. No factory reset, socket
  deletion, WSL reset, volume deletion or credential replacement was needed.
- Restored retained knowledge PostgreSQL, main/demo PostgreSQL, Redis, the
  API/worker/engine supervisor and observability supervisor. Migrations reported
  none pending. Existing configuration/data were retained.
- Reran scripts/verify-p8.py and captured exit code 0 plus its final success line.
  Actual HTTP login/RBAC/PostgreSQL approvals exercised real Docker rollback only
  inside the simulated training sandbox. Image/version/readiness matched;
  successful_checkouts=3, samples=3, window_seconds=3.187. Terminal result VERIFIED.
- Duplicate execution returned NO_EXECUTION; one competing attempt verified.
  Security checks passed for revoked role, disabled account, reset token, expired
  approval, changed binding, forged viewer approval, stale container, abandoned
  attempt reconciliation without mutation, and immutable execution token. The
  incident was not automatically resolved.
- The wrapper's outside-container snapshot assertion passed and its temporary
  API database was removed. A separate PostgreSQL count confirmed zero remaining
  sentinel_p8_verify_* databases, closing the earlier interrupted-cleanup concern.
  Updated evidence: .artifacts/p8-sandbox-verification.json.
- Final service checks: API 3000, engine 8001, checkout 3001, payment 3002 and
  Prometheus 9090 returned 200. Anonymous /api/v1/services returned 401. Loki 3100
  initially returned a warm-up 503, then its /ready returned 200; collector
  containers remained running. This transient check was retried, not hidden.
- Combined completed suites from the preceding 2026-10-18 run remain 97 API,
  50 engine, 32 payment, 17 checkout, 9 executor/security = 205 passing tests.
  P5 live/permission, P6 live/synthetic evaluation and P7 real embeddings/pgvector
  checks are recorded above; they were not unnecessarily repeated on resumption.
- Scope: this completes the selected remaining local regression/end-to-end checks,
  not a rerun of every historic P1/P2/P4 standalone load/fault verifier. Cloud
  deployment, production remediation and real chat-model quality remain untested.
- No user account or saved investigation was changed by these tests. The sandbox
  ends recovered at payment-v1, with its registry invalidated by verifier cleanup.
  For a later interactive rollback exercise run sandbox-local.py again to prepare
  a fresh faulty binding, then start sandbox_executor.py --watch and explicitly
  review/approve through the UI. No new setup is needed for ordinary investigations.
- Documentation-only commit: test(P8.5): record completed sandbox regression and cleanup.

## P9.1 — Authenticated React foundation (2026-10-19 IST)

- Approval: user approved the detailed P9.1–P9.6 plan before code changes.
- Implemented the apps/web workspace with pinned React/Router/Vite/Vitest/browser
  dependencies, strict TypeScript, in-memory login/expiry, abortable typed API
  reads, navigation and the real service registry screen. No schema migration.
- Added optional built dashboard serving at /dashboard/ with CSP, deep links and
  missing-asset/API boundaries; existing auth-test remains available. API test
  script builds the frontend first so a fresh checkout can run the route test.
- Verification: production build passed; 5 frontend tests passed; 1 real HTTP
  built-asset/deep-link/CSP/404 test passed. Mock login/data are synthetic; tests
  do not use the learner's password. Formatting and diff whitespace checks passed.
- Manual setup: no new account/secrets/cloud work. npm ci; npm run dev:web;
  open http://localhost:5173/dashboard/. Existing backend must be running.
  Production assets are served after building web/API and restarting the API.
- Full file walkthrough, arguments, async/error/security flow, debugging and 3
  questions/independent exercise are in docs/P9-LEARNING-GUIDE.md. Learner answers
  remain pending. Public deployment is not performed.
- Commit: feat(P9.1): add authenticated React dashboard and service overview.

## P9.2 — Incident workspace (2026-10-19 IST)

- Approval: included in explicit P9.1–P9.6 approval. Implemented URL filters/cursor
  pagination, incident details, role-aware creation/status changes and service links.
- Production build passed and all 9 frontend tests passed, including VIEWER write
  controls, malformed records, filter queries and network-failure/empty distinction.
  UI tests use synthetic fixtures; final real browser checks follow in P9.6.
- No schema migration or manual setup required. File walkthrough, async/error flow,
  run/debug commands and learner questions/exercise are in P9 learning guide.
- Commit: feat(P9.2): add incident workspace with filters and server-confirmed status.

## P9.3 — Evidence presentation (2026-10-19 IST)

- Approved P9 scope: saved metric SVG/sample tables, log truncation, deployment
  states, calculations, exact provenance, reports/fact anchors and knowledge quotes.
- Build passed; 12 frontend tests passed. Missing samples remain missing, numeric
  zero preserved, large gaps split, units labelled and unverified snapshots rejected.
  Intermediate JSX syntax failure corrected before acceptance. Fixtures are synthetic.
- No manual setup, database migration or collector credentials in browser required.
  P9 guide records file/function walkthrough, error paths, commands and learner checks.
- Commit: feat(P9.3): visualize saved evidence with provenance and report citations.

## P9.4 — Investigation controls and SSE (2026-10-19 IST)

- Approved scope implemented: stable-key enqueue, explicit new request key, saved
  run selection and authenticated fetch/SSE progress, replay and bounded retries.
  PARTIAL events accepted; replay deduplicated and ordered with BigInt sequences.
- Build and all 15 frontend tests passed. Tests exercise parsing split/multiline
  frames, wrong scope, oversized data and duplicate/large-sequence replay.
- Abort/expiry cleanup and terminal-event evidence refresh preserve server authority.
  No migration/manual setup; file walkthrough and learner checkpoints are in P9 guide.
- Commit: feat(P9.4): add bounded investigation progress and replayable timeline.

## P9.5 — Approval and audit UI (2026-10-19 IST)

- Approved scope implemented: allowlisted dry run, stable-key proposal creation,
  exact saved-binding review, ADMIN/expiry-aware confirmation and audit/results.
- Build and all 17 frontend tests passed, including non-admin, expired, changed
  binding, terminal, cross-incident and non-sandbox rejection. Backend authorization
  remains mandatory. No user proposal executed during implementation.
- Read-only UI needs no manual setup. Interactive real sandbox execution still needs
  fresh sandbox preparation, separate watcher and explicit human approval. Full
  file/function walkthrough, errors/security and learner exercise are in P9 guide.
- Commit: feat(P9.5): add exact sandbox approval review and audit interface.

## P9.6 — Responsive accessible dashboard acceptance (2026-10-19 IST)

- Approved six-task scope completed: responsive layout, route focus/skip link,
  recoverable invalid data, keyboard-scrollable evidence, bounded idle streams,
  disabled stale confirmation, and clear loading/empty/error/partial states.
- Final production builds passed. 19 frontend tests passed. 9 real Edge browser
  tests passed (29.9s), including exact saved sample comparison, persisted incidents,
  investigation progression/replay, real backend role denial/approval, duplicate-click
  guard, mobile URL pagination/evidence, escaped text and injected failure/expiry.
- Axe reported zero A/AA violations on tested overview/evidence/modal/mobile views;
  keyboard/390px overflow checks passed. No full screen-reader/device audit claimed.
- Test fixture uses generated accounts and a guarded disposable local API DB; real
  engine evidence is stored/read. Its test-only poller is not BullMQ. Synthetic
  sandbox bindings exercise UI/backend authorization without any Docker execution.
- Cumulative API/P3.5 verifier passed all 98 tests, zero skips/failures, with required
  live knowledge and evidence, real isolated PostgreSQL/Redis/BullMQ, dashboard
  HTTP/CSP/deep-link boundaries and restart/outage recovery. Report project:
  p3-5-290b67b9. Test containers removed, volumes retained.
- Initial harness/keyboard/select-locator failures corrected before the final full
  passing rerun. Failed temporary DBs also cleaned. Final browser report and visual
  evidence are ignored .artifacts/p9-* files, not credentials committed to Git.
- Manual setup: no new account/DB/cloud task. npm ci after pulling; use dev:web or
  built /dashboard with existing backend. Existing main account/incident untouched.
  Manual/learning guides document commands, files/functions, async/error/security,
  positive/negative tests, debugging and learner questions/exercise for each task.
- Public hosting/model quality and learner checkpoints remain open; P10 not started.
- Commit: feat(P9.6): verify accessible responsive dashboard with isolated browser tests.

## P10.1 — Portable checks and CI (2026-10-19 IST, verified)

- Approval: user continued after detailed P10.1 concepts/files/risks/tests plan.
- Added pinned JS lint tooling, existing-Ruff safety rules, portable fail-fast tiers,
  stdin positive/negative controls and separate fast vs required integration checks.
- Workflow: official full-SHA action pins, read-only permissions, Windows/Linux fast
  matrix, Linux integration, time limits/cancellation and safe summary artifacts.
  Fresh-runner bootstrap guards existing state; CI-only Prometheus host override
  preserves local loopback bindings. No schema/API/production deployment changes.
- Lint baseline found six issues; intentional control rejection retained with local
  comments, useLoad dependency handling and dialog cleanup improved, unused parameter
  renamed. New stale-response and fail-fast/developer-state regressions added.
- Actions API availability confirmed enabled. Compose override config validation
  passed without starting/changing local containers. Negative/positive lint probes
  and failure propagation passed. Local acceptance passed; remote acceptance also passed (run linked below).
- Local fast: checkout 17, API non-DB 42, React 20, payment 32 and engine 50
  passed. Updated scripts suite: 13 passed. Format, lint and stdin controls passed.
- Local integration: cumulative API 98 passed (zero skips), deployment-reader
  permission checks, sequential/parallel live evidence, real embeddings/pgvector,
  real isolated Docker rollback/security checks and all 9 browser checks passed.
  Test databases/containers cleaned; developer records and persistent volumes retained.
- Walkthrough, commands, test scope, security, manual steps and learner questions
  are in docs/P10-LEARNING-GUIDE.md. No P10.2 work started.

- First remote run: Linux fast passed; Windows format failed because checkout
  converted source to CRLF. Added .gitattributes LF text checkout policy; no
  repository-wide formatting rewrite. Integration correctly remained gated.

- Remote acceptance: GitHub run [39251878743](https://github.com/vikramadityasaipulapa-1975/sentinel/actions/runs/39251878743)
  at code commit db4a393 passed all three required workflow jobs: Ubuntu fast,
  Windows fast and fresh Ubuntu integration/browser. No skipped integration job.
  This validates the fresh Linux bootstrap, model downloads, image builds and
  collector loopback override, in addition to the locally measured checks.
- Implementation commits: 838903b; Windows checkout correction db4a393. Both use
  configured account as sole author, no co-author trailers; pushed to origin/main.
- No new manual hosted setup or repository secret is required. Pull and npm ci;
  optional merge rules and exact verification steps are in MANUAL-SETUP.md.
- P10.1 software acceptance complete. P10.2 requires a new learning-first approval;
  public hosting, optional chat-model evaluation and learner checkpoints remain open.

## P10.2 — Fault matrix and incident quality (2026-10-20 IST)

- Approval: user continued all after the nine-trial fault-quality plan and approval
  checkpoint. P10.2 only; later tasks retain their learning-first checkpoints.
- Separate native checkout/payment ports, Prometheus/Loki/Alloy/Alertmanager project,
  temporary OPERATOR, guarded disposable local database and private stdin processor.
  Existing rule, webhook auth, migration, report validation and persistence reused.
- Real async evidence tools and deterministic synthesis run against isolated telemetry;
  SELECT-only existing deployment registry is read. No chat-model, knowledge retrieval,
  BullMQ processor, executor or remediation is used by this experiment.
- New scoring/config/cleanup tests pass: seven focused checks. Full scripts suite
  passed 19 before the cleanup regression was added; final count recorded below.
- Fresh API compilation, JS lint and Python safety lint passed. Synthetic baseline
  rerun: 10 fixtures, 6/7 top-1 labelled causes, 18/18 citation references valid,
  one false deployment attribution among six nondeployment causes; not live accuracy.
- Completed live run sentinel_p10_quality_24d3a37eb651: nine trials, three healthy
  controls, six dependency faults. Detected 6/6, no healthy false incidents (0/3),
  one incident per fault, saved top category correct 6/6; no model inference.
- Detection seconds: error 15.032/17.563/18.547; timeout 24.656/24.609/23.547.
  Median 21.047, range 15.032–24.656, n=6 detected faults. Recovery passed 6/6;
  resolved signals left incidents OPEN. Trial requests 569, recovery requests 540.
- Actual HTTP cohorts, saved hashes/categories/model flags independently checked.
  No owned containers, database or generated token remain after cleanup.
- Limits retained: calculations PARTIAL 9/9, deployment EMPTY 9/9; Loki PARTIAL
  3/9 from retrieval cap. Dependency-only live ranking is not broad causal or
  production/model accuracy. Synthetic baseline remains a separate denominator.
- Full table, sample size, protocol, uncertainty and reproduction in
  docs/P10-EVALUATION.md. P10.3 not implemented.
- Manual steps and task walkthrough added to the learning/manual guides. No new
  manual cloud setup or secrets required. Public hosting remains deferred.

- Final local fast tier PASSED: format, JS/Python lint, positive/negative controls,
  all builds, checkout 17, API non-DB 43, React 20, payment 32, engine 50, scripts 20.
  Live quality experiment is separate from synthetic fixtures and CI integration.
- Commit subject: feat(P10.2): measure isolated live fault detection and hypothesis quality.
  Configured Git account remains sole author; no co-author trailer. Remote workflow
  outcome is verified separately in Actions rather than inferred from local tests.

- P10.2 remote acceptance: commit 267def8 passed all three GitHub jobs in
  [run 39311757608](https://github.com/vikramadityasaipulapa-1975/sentinel/actions/runs/39311757608):
  Linux/Windows fast and fresh Linux integration/browser. Local nine-trial experiment
  is separate from this CI suite. P10.2 task is complete; learner checkpoint remains open.

## P10.3 — Failure isolation and budgets (2026-10-20 IST)

- Approval: user explicitly approved P10.3 after the task plan via the approval prompt.
- Checkout now has a total operation deadline including retry/backoff/body reads,
  process-local consecutive-failure breaker with one logical recovery probe and a
  no-wait capacity limit. Default breaker enabled. No schema/package/cloud changes.
- Existing structured errors retained; new 503 PAYMENT_BUSY/PAYMENT_CIRCUIT_OPEN and
  504 PAYMENT_BUDGET_EXHAUSTED distinguish controlled rejection/budget expiry.
- Fake-clock and real HTTP-stub checkout suite passed 25 tests, including eight new
  resilience tests. Actual 2.7-second source-cancellation graph regression passed;
  graph suite three passed. Full local fast tier passed: checkout 25, API non-DB 43,
  React 20, payment 32, engine 51, scripts 20; format/lint/controls/builds passed.
- Real isolated Express/FastAPI probe passed: simulated failures open the breaker,
  a recovery probe closes it, latency budget response in 0.437 seconds, health stays
  responsive and capacity recovers. Owned native children stopped; no database
  used. Added this short check and its safe artifact to CI integration.
- No production collector/worker timeout rewrite needed after reviewing existing
  budgets and adding the actual hanging-source cancellation regression. Delivery
  workflow result remains a separate remotely observed check.
- Existing engine/model/collector/worker bounds reviewed and retained. Training
  helpers/sandbox explicitly disable the breaker so raw fault/recovery experiments
  retain their original meaning. Ordinary checkout/base Compose defaults stay enabled.
- Learning guide/manual/.env.example document every setting, file/function, security,
  test scope, remaining limitations, restart steps and learner exercise. No hosted
  resources provisioned; no running user demo/sandbox image or process overwritten.

- P10.3 remote acceptance: commit 4a79d4a passed Windows/Linux fast and fresh Linux
  integration/browser, including the real enabled-breaker probe, in
  [run 39313825291](https://github.com/vikramadityasaipulapa-1975/sentinel/actions/runs/39313825291).

## P10.4 — Secret/config/access/audit review (2026-10-20 IST)

- User explicitly approved the security plan before implementation. Pinned Gitleaks
  8.30.1 official Windows/Linux x64 archives with SHA256 verification, exact-member
  reading, bounded calls and no source upload. Only safe finding metadata is emitted.
- Worktree/nonignored files plus all reachable history scanned. Shallow clones,
  tracked secret .env, symlinks/outside-workspace paths and tool failures fail closed.
- Initial incomplete negative fixture failed detection and correctly blocked the
  scan. Corrected to pinned github-pat rule syntax; generated value never issued by
  a provider. Negative/positive and reviewed-path controls pass.
- Initial ten matches were reviewed public model/source hashes and a migration
  filename, not credentials. Exact values AND exact paths excepted only for generic
  API-key rule; provider rules/commits/directories are not excluded. Latest measured
  scan passed over 59 reachable commits and 281 files before final documentation.
- Three checksum/archive/redaction tests and the real-JWT HTTP canary/access test
  passed. Full local fast PASSED: checkout 25, API non-DB 44, React 20, payment 32,
  engine 51, scripts 23; format/lint/control/build checks passed.
- Completed local cumulative run dd5885db: 100 tests, 98 passed, two reported
  failures (required knowledge UNAVAILABLE vs OK plus parent suite). All new audit
  UPDATE/DELETE/decision-identity assertions passed. No full local cumulative pass
  is claimed and no application deadline/assertion was relaxed.
- Diagnostics: cold retrieval returned three citations in 8.875 seconds outside the
  application budget; subsequent unchanged bounded path succeeded in 7.296 seconds.
  Local runtime readiness remains limited under current resources.
- Earlier attempts: required-knowledge failure (83c5dc91), then old 120-second
  combined build/test wrapper expiry (b3c88d4a) caused cleanup-related DB errors.
  Raised only the bounded build/test command budget to 300 seconds; later run
  completed and isolated the actual remaining knowledge limitation. All temporary
  containers removed; volumes retained. Remote CI remains separately verified.
- Existing production configuration/authorization/redaction retained after review.
  No schema changes, credential rotation, raw secret output, deployment or history
  rewrite. CI adds full-history Secret scan gate and safe summary artifact.
- Security/learning/manual docs explain findings, tests, CORS vs auth, normal-SQL audit
  limits, hosted role/retention responsibilities and learner questions/exercise.

- Final pre-commit source scan PASSED: 59 reachable commits, 282 worktree files,
  all controls passed, no remaining findings. Final focused tool tests three passed;
  Python lint and repository format checks passed after final helper/doc updates.
- Commit subject: feat(P10.4): verify secret hygiene and authorization audit boundaries.
  Configured account remains sole author, no co-author trailer. Remote four-job CI
  outcome is checked separately, with required knowledge still enabled in integration.

## P10.5 — Reproducible foreground demo (2026-10-20 IST)

- Approval: user approved the explained portable launcher/preflight/readiness/setup
  reuse/fresh-checkout CI/manual-documentation scope before implementation.
- P10.4 remote acceptance: all four jobs (Windows/Linux fast, full-history Secret
  scan, fresh Linux integration/browser with required knowledge) PASSED for a8c6ae1
  in [run 39317985760](https://github.com/vikramadityasaipulapa-1975/sentinel/actions/runs/39317985760).
  Prior strict local cold-knowledge failures remain recorded above.
- Added scripts/demo.py and demo_support.py: read-only preflight before installs/
  preparation; reuse locked setup/migration/seed paths; direct native child ownership
  with partial-start cleanup; separate core/knowledge probes; retained dependency data.
- CI uses the same shared preflight/preparation/runtime path, asserts owned children
  stop and config bytes survive runtime/repeated preparation. Cleanup attempts all
  known CI projects, retaining volumes. Safe demo summary added to artifact allowlist.
- Evidence setup now appends only missing defaults, preserving existing comments/
  custom settings/secrets. Observability webhook file explicitly uses UTF-8.
- Local initial script suite passed 33 tests including ten new socket/ownership/
  configuration/Linux collector/readiness regressions. Test doubles are explicit;
  real project DBs were not used for these unit tests. Python lint passed.
- Actual local negative startup returned occupied-port 3000 before any preparation;
  existing owner was not stopped. Actual read-only doctor returned all eight core
  endpoint probes READY and unchanged bounded knowledge probe READY. Worker is
  explicitly NOT_CHECKED_BY_HTTP. This single sample does not erase prior slow runs.
- Current user stack/config/databases retained. Full local fast/security and fresh
  Linux CI outcomes are recorded below only after actually observed. No fresh Windows
  standard-port startup claimed while user's existing stack occupies those ports.
- docs/P10-DEMO.md gives the complete required learning workflow, per-file/function
  walkthrough, commands/expected outputs, manual account/collector setup, debugging,
  three questions and independent exercise. Manual/learning/README link this guide.
- No new API/schema/default human account, automatic fault/action executor, cloud
  provisioning, payment or external deployment. Existing public-hosting checklist
  remains pending; P10.6 requires separate explanation and approval.

- Final local fast tier PASSED: checkout 25, API non-database 44, React 20, payment
  32, engine 51, script tests 33; format, JS/Python lint, negative controls and builds
  passed. Focused final demo tests ten passed after lifecycle-test refinement.
- Pre-commit security scan PASSED: 60 reachable commits, 286 worktree files, generated
  negative/positive/reviewed-path controls passed and no findings.
- Commit subject: feat(P10.5): add a supervised reproducible local demo workflow.
  Configured account only, no co-author trailer. Fresh Linux shared-lifecycle CI
  acceptance remains pending at this commit; do not infer it from local unit checks.
