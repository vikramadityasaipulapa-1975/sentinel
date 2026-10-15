# Sentinel progress

Current phase/task: P1 implementation complete (P1.1-P1.7)
Status: IMPLEMENTATION VERIFIED; learner checkpoints pending; P2 not approved
Last completed implementation task: P1.7
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
