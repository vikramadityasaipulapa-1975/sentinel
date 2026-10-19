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

## P10.2 — Fault matrix and incident quality

### Concept

A fault matrix lists controlled conditions and expected behavior before running
an experiment. Detection delay is measured from fault-mode readiness/traffic start
to the first observation of a new persisted incident. This includes scrape, rule
hold, Alertmanager grouping/delivery and polling delay. It is not just API latency.
Top-1 accuracy compares the first saved hypothesis category with the known injected
category. Missing detections and unsaved reports remain in the denominator.
Healthy controls measure false incident creation separately. These are simulated
payments and local measurements; no production or chat-model accuracy is claimed.

### Architecture/data flow

Owned native checkout/payment → separate Prometheus and Alloy/Loki → separate
Alertmanager → authenticated backend webhook → disposable PostgreSQL incident.
An OPERATOR requests an investigation using the real API. Python calls the existing
parallel engine workflow against the separate collectors and the existing SELECT-only
local deployment registry. A test-only stdin processor claims the queued job and
uses the existing backend finish transaction to validate/store evidence and report.
The runner reads the saved report through authenticated HTTP with hash verification.
This processor is not BullMQ, which was separately tested in P10.1. No knowledge
retrieval, optional model inference, Docker executor or automatic remediation runs.

The nine-trial default is three repetitions of healthy, payment error and payment
timeout. Fault category is dependency for both fault modes: the checkout application
is receiving failures/timeouts from its payment dependency. Healthy traffic runs
35 seconds; faults run 40 seconds; each fault is followed by 45 seconds of healthy
recovery. One request can be in flight, with a target interval of 0.5 seconds and
an eight-second transport deadline. Achieved rates and HTTP counts are measured;
slow requests lower throughput rather than creating an unbounded work queue.

The existing 30-second error-ratio rule, six-second hold, two-second scrape/evaluation
and Alertmanager grouping remain unchanged. Misses are reported at the observation
budget, not retried indefinitely. Polling can overestimate incident persistence delay
by roughly a request duration plus pacing/query overhead. Startup is excluded.

### File plan → Approval checkpoint

The user approved the preceding explanation with CONTIUE ALL. This implements all
of P10.2's approved matrix, scoring, tests, documentation and delivery. P10.3 has
not been implemented; it requires its own explanation and approval. No new API
contract, schema, production dependency or hosted resource is introduced.

### Implementation → Walkthrough

- scripts/verify-p10-quality.py owns a uniquely named artifact directory and database.
  settings reads existing ignored configuration without printing it. free_ports holds
  probes until all six distinct loopback ports are selected; readiness checks catch
  a later port race. launch keeps exact child handles and separate ignored logs.
- mode stops only its previous payment child, starts normal/error/latency mode and
  waits for health. traffic sends fresh simulated order IDs serially and records
  actual status counts, elapsed time and requests/second. It never sends real money.
- observe uses monotonic time and queries only the disposable database for newly
  persisted episodes. Healthy incidents, duplicate incidents, misses, partial sources
  and recovery outcomes are retained in JSON rather than hidden by a green label.
- collect runs the existing read-only async tools in the parallel workflow, synthesizes
  deterministic hypotheses and serializes exact evidence windows. Calls remain bounded
  by existing tool/workflow deadlines. The Windows SelectorEventLoop is selected for
  psycopg async reads. Short windows can produce INSUFFICIENT_DATA for metric halves;
  log-supported hypotheses must not be described as complete metric comparisons.
- apps/api/test/quality-fixture.ts refuses any database/directory outside its exact
  generated local pattern, applies existing migrations, seeds services and creates a
  temporary OPERATOR. It serves the existing authenticated routes on loopback.
  Private stdin accepts bounded collections, claims a 30-second lease, and calls the
  existing finish transaction. It exposes no new HTTP completion bypass. Backend
  validation/hash/citation checks remain active. Credentials are environment-only.
- scripts/quality_support.py generates Compose/configuration from existing pinned
  collector images. Separate logs/configs/ports prevent existing telemetry and
  Alertmanager deliveries from leaking into user incidents. Linux uses host networking
  only for the two collectors needing loopback access, binding their web listeners
  to 127.0.0.1. Windows uses Docker Desktop host forwarding. No shared named volumes.
- summarize separates healthy controls, retains fault misses and failed reports in
  top-1 denominator and refuses negative/nonfinite delays. Min/median/max apply only
  to detected faults; that conditional sample count is always included.
- apps/api/test/quality-fixture.test.ts launches the fixture with a main database
  and a mismatched directory and proves both are rejected before connecting.
- scripts/tests/test_quality.py checks a successful match, a missed detection, a
  failed report, a healthy false positive, invalid times, empty data and Linux config
  isolation. Existing rule tests remain separate from live quality measurements.
- finally stops owned children, brings down only the unique collector project, drops
  only the generated test database, deletes the generated webhook token and writes
  ignored JSON reports. No .env rewrite, shared container stop, volume prune, account
  mutation or production incident operation is performed.

### Run/test

From V:\sentinel\sentinel, with existing local API PostgreSQL and deployment-reader
configuration ready, Node/Python requirements installed and Docker Linux engine up:

```powershell
$env:PYTHONUTF8='1'
npm run build
.venv\Scripts\python.exe -m pytest scripts/tests/test_quality.py -q
.venv\Scripts\python.exe scripts/verify-p10-quality.py
.venv\Scripts\python.exe scripts/evaluate-p6.py
```

Default live sample size is nine trials. --repetitions 1 is a three-trial diagnostic
run and must not be reported as the nine-trial experiment. MEASURED means the matrix
finished, not perfect detection/accuracy. FAILED means setup, execution or cleanup
failed. Detailed outputs are ignored .artifacts/p10-quality.json and the unique
run's results.json. Synthetic P6 evaluation is deliberately a separate artifact.
Measured results, actual command outcomes and limitations belong in P10-EVALUATION.md.

### Debug

Missing compiled fixture: npm run build. No Docker: start Docker Desktop with Linux
containers. Read only this run's ignored logs; do not paste credentials. No alerts:
inspect the separate Prometheus target/rule state and Alertmanager route, then the
isolated backend log. Do not point its receiver at the user's main API. A missing
Loki source or unsaved report is not a successful hypothesis. Keep all failed trial
records. Never delete development volumes to make an experiment pass.

### Manual setup

No new manual cloud setup, account or secret required. Existing local .env.api and
.env.evidence must be prepared using the earlier guides. Docker Desktop must run.
The runner generates separate local secrets and ports; it does not need the main
API, observability helper, engine or executor stopped. This heavy experiment is an
explicit developer command, not added to every fast CI push. Public hosting still
requires the separate hosted setup; these local results do not provision it.

### Understanding check

1. Why would excluding missed detections inflate top-1 accuracy?
2. Why are detection delays reported together with the number of detected faults?
3. Why must recovery of an alert signal leave the incident open?

Exercise: use --repetitions 1, compare achieved rates in error versus timeout trials,
and explain why one in-flight request limits the timeout trial's throughput. Keep
that diagnostic result distinct from the documented nine-trial run.

### Commit summary

feat(P10.2): measure isolated live fault detection and hypothesis quality.
The nine-trial run completed: six faults detected/correct saved top category, zero
incidents in three healthy controls, median detection 21.047 seconds, six recovery
checks passed. This is a narrow dependency-only local sample with partial metric
comparisons; see P10-EVALUATION.md and PROGRESS.md for actual results and limits.
Changes are committed/pushed under the configured sole author after local checks.
GitHub Actions verifies fast checks on both platforms and the existing integration
tier; the heavy nine-trial quality experiment remains explicit local developer work.
