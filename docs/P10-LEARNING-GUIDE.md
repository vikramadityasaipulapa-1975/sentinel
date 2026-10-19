# P10: hardening and delivery — learning guide

## P10.1 — Portable checks and continuous integration

### Concept

Unit tests check small functions/components, integration tests exercise dependency
boundaries, and end-to-end tests exercise a browser through the backend. Fixtures
are controlled inputs; fake clocks make expiry tests deterministic. Existing P9
session tests use a fake clock, while integration probes measure actual time.
A green unit tier does not mean the database/browser tests ran. Required separate
jobs make that difference visible. CI runs a fresh checkout, not the developer's
persistent local configuration or account.

### Architecture/data flow

Push to main / pull request / manual dispatch → fast checks on Windows and Linux →
required Linux integration/browser job. Node 24.11.1 and Python 3.11 are selected;
locked npm and pinned Python dependencies are installed. Generated test passwords,
JWT/webhook keys and DB configuration remain on the temporary runner. No repository
secret, user account, paid provider, cloud database or deployment is required.

The integration bootstrap starts known local Compose projects and native loopback
services, downloads hash-pinned embedding artifacts, builds the training images and
runs serial isolated verifiers. Prometheus uses a Linux-only host-network override
so native services remain bound to 127.0.0.1. Developer Compose settings are unchanged.
Only safe summary JSON files are uploaded for seven days, never .env files or raw
backend logs. Workflow permission is contents:read; checkout does not persist Git
credentials; official actions are pinned to resolved full commit SHAs. Superseded
runs are cancelled and jobs have time limits. No pull_request_target event is used.

### File plan → Approval checkpoint

The user approved the P10.1 teaching plan before code/dependency changes. Scope is
portable test/lint/CI tooling, targeted uncovered regressions and documentation.
P10.2 fault-quality benchmarking is not started. No schema/API change is needed.

### Implementation and file-by-file walkthrough

- .github/workflows/ci.yml defines fast OS matrix and a gated Linux integration
  job. Fast excludes the DB-only module explicitly; integration requires actual
  PostgreSQL/Redis/live evidence/knowledge and browser checks. Actions pins were
  resolved from official action releases, not guessed major tags.
- .gitattributes preserves LF text checkouts on both operating systems. The first
  remote Windows run exposed CRLF/Prettier mismatch; this policy fixed checkout
  reproducibility without rewriting every source file.
- eslint.config.mjs enables core error checks, TypeScript-aware unused variables,
  React hook rules and dependency checks. TypeScript owns undefined-name checking.
  Two incident-title control-character regexes retain intentional ASCII rejection
  with local explanatory lint comments. Security validation is not weakened.
- ruff.toml selects Python syntax/invalid-statement/undefined-name checks with Ruff
  already pinned by existing requirements. This is not a repository-wide style
  migration; unused-import/style enforcement is not claimed.
- scripts/check.py chooses .venv's interpreter when present or the active CI Python
  otherwise. run(label,args,results,env,timeout) executes argument arrays, fails on
  nonzero exit/deadline, and only then appends a safe passed summary. It never logs
  environment values. Reports are ignored .artifacts/ci-TIER.json files.
- check.py lint/fast performs format, TS/React/Python lint and positive/negative
  controls. Deliberate stdin-only TS const reassignment and Python undefined-name
  fixtures must fail with the intended rule; a valid Python fixture must pass.
  A child exit 23 must propagate. No tracked source is temporarily corrupted.
- Fast then builds all workspaces, runs compiled checkout/API non-DB tests, React,
  payment, engine and executor/check-runner tests. Empty compiled-test lists fail.
- Integration sets TEST_KNOWLEDGE_REQUIRED=1 and runs the real API/queue verifier,
  restricted deployment-reader checks, sequential/parallel engine, real pgvector,
  isolated Docker rollback and isolated browser checks serially. Fault/load quality
  metrics and every historical P1/P2/P4 scenario are not implied by this tier.
- scripts/ci-bootstrap.py refuses non-Linux/non-GitHub execution, existing ignored
  configuration and existing Sentinel containers before touching Docker. It starts
  a separately owned API process group and stops only owned processes/projects in
  finally. Volumes are not pruned/deleted. It never runs on a developer machine as
  the normal test entry point. Generated configuration is never committed.
- infrastructure/ci/compose.observability.yaml overrides only CI Prometheus network
  settings. Compose configuration validation runs without changing local containers.
- Common.tsx useLoad now keys reads on primitive request identity rather than a new
  inline callback each render. A ref receives the current callback in an effect;
  requests still abort on key changes/unmount. Regression resolves an old response
  after a new response and proves the newer result stays displayed.
- Confirmation.tsx captures the actual dialog element for cleanup; checkout's 404
  handler names its unused response parameter explicitly. No contract changes.
- scripts/tests/test_checks.py proves failed commands never append a pass and the
  CI bootstrap refuses developer configuration before reaching Docker.
- package.json/lock add pinned JS lint tooling and portable check commands. Existing
  phase-specific Windows commands remain available for compatibility.

### Run/test

From V:\sentinel\sentinel:

```powershell
npm ci
.venv\Scripts\python.exe scripts/check.py lint
.venv\Scripts\python.exe scripts/check.py probes
.venv\Scripts\python.exe scripts/check.py fast
# Existing Docker/API/evidence/knowledge stack and cached sandbox images required:
.venv\Scripts\python.exe scripts/check.py integration
```

Expected: each step prints CHECK then PASS only after successful execution; a failed
step stops the tier and records FAILED. Do not run ci-bootstrap.py locally. Fast
requires installed project Python requirements but no DB. Integration is deliberately
real and may change only its separate training sandbox, never production payments.
Measured local/GitHub results are recorded in PROGRESS.md after actual completion.

### Debug and security considerations

Missing modules: install both existing requirements files into .venv and npm ci.
A missing DB/browser is a failure in integration, not an optional silent skip.
API/engine unavailability: restore existing helpers, do not reset volumes. A lint
negative control returning exit 2 means configuration broke, not a successful test.
Investigate the intended rule marker. Keep generated credentials out of reports.
No automatic fix command is run across unrelated files.

CI caches downloads only; it does not restore local .env or database volumes. The
integration environment uses real collectors/engine, synthetic temporary accounts
and explicitly simulated payments. Browser binding fixtures are synthetic; real
Docker rollback is separately tested in the same integration tier. No model account
or real-world LLM quality claim is made. Public hosting remains separate work.

### Manual setup

GitHub API confirmed Actions is already enabled for this repository. No new hosted
service/account or secret is needed. After pulling, npm ci installs lint packages.
Repository Actions policy or allowance can still block a run; report that rather
than purchasing capacity or claiming a remote pass. Optional required-merge rules
are documented separately and are not silently changed by this task.

### Understanding check

1. Why is a fast green result insufficient without a required integration job?
2. Why must a lint negative control check its rule and exit code, not just fail?
3. Why must CI generate configuration rather than copy a developer's .env files?

Exercise: add a small failing assertion on a temporary branch, observe a failed CI
check, then fix it. Do not alter main just for this exercise. Learner answers and
independent work remain pending.

### Commit summary

feat(P10.1): add portable lint and isolated cross-platform CI checks

Implementation 838903b and checkout fix db4a393 were pushed with the configured
account as sole author and no co-author trailer. Local fast/integration tiers passed;
[GitHub run 39251878743](https://github.com/vikramadityasaipulapa-1975/sentinel/actions/runs/39251878743)
passed Windows fast, Linux fast and fresh Linux integration/browser for db4a393.
See PROGRESS.md for counts and the recorded first-run failure. A subsequent
documentation-only commit records these observed results; its automatic CI run
is a separate run, not evidence used retroactively for this record.
