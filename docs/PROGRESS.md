# Sentinel progress

Current phase/task: P2, awaiting Docker/Compose acceptance
Status: DATABASE/NATIVE VERIFIED; CONTAINER VERIFICATION BLOCKED; P3 not approved
Last fully accepted software phase: P1; P2 native checks passed, container gate open
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
