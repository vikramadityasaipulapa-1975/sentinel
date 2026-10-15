# Sentinel progress

Current phase/task: P1.6 (P1.7 authorized next)
Status: IMPLEMENTATION VERIFIED; learner checkpoints pending
Last completed task: none

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
