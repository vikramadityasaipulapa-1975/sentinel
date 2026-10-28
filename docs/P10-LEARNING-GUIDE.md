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

## P10.3 — Timeouts, retries, circuit breakers and budgets

### Concept

A timeout limits one attempt, including response body reading. Retrying that call
can still multiply total duration. A total deadline includes attempts and backoff.
Retries are capped and preserve the idempotency key because a timeout cannot prove
that the remote payment operation did not complete. Payments here remain simulated.
A circuit breaker stops repeated calls temporarily after dependency failures; after
a cooldown, only one logical checkout can probe recovery. A concurrency bulkhead
caps active checkout-to-payment operations without creating a waiting queue.

Alternatives include relying only on per-attempt timeouts (does not isolate repeated
faults), using a shared Redis breaker (adds a dependency/coordination failure mode),
or adding a resilience package (unnecessary for this small explicit state machine).
Chosen state is in memory per createApp/process. Replicas have independent limits;
a restart resets breaker state. This is not a global capacity/expense guarantee.

### Architecture/data flow

Valid checkout and stable idempotency key → process-local gate → bounded pay loop
→ downstream payment HTTP → validated result/error → release capacity in finally.
No capacity queue is created. The breaker rejects an OPEN circuit or concurrent
HALF_OPEN probes with 503 PAYMENT_CIRCUIT_OPEN. Saturation returns 503 PAYMENT_BUSY.
Each existing retryable failure may retry up to the existing maximum two attempts;
the same request data/key survive retries. A total timeout returns 504
PAYMENT_BUDGET_EXHAUSTED; per-attempt expiry still uses PAYMENT_TIMEOUT when budget
remains. Other existing payment errors/conflicts retain their contracts.

The gate counts failed logical operations, not each attempt. A 409 business conflict
is reachable dependency behavior and resets consecutive failure accounting. Input
validation occurs before gate acquisition. Unknown exceptions count as failure;
capacity release remains guaranteed. An older in-flight result cannot override a
newer OPEN transition because each permit captures a breaker generation.

### File plan → Approval checkpoint

User explicitly approved P10.3 after the concepts/files/tests/risk explanation via
the approval question. Changes stay within checkout resilience, its tests, one
existing async source-deadline regression, training-profile compatibility and docs.
No migration, new package, external deployment or optional model purchase occurs.

### Implementation → Walkthrough

- config.ts adds optional fields so existing typed test callers remain compatible.
  paymentLimits(config) resolves defaults and validates finite integer ranges.
  readConfig maps environment strings into these fields and accepts only literal
  true/false for PAYMENT_CIRCUIT_ENABLED. Configuration errors omit supplied values.
- resilience.ts PaymentGate owns active count, consecutive failures, state,
  openedAt monotonic time, generation and probe flag. acquire() rejects immediately
  when unavailable or full and otherwise returns a release(healthy) callback.
  Each callback releases once. Failure can open/reopen the circuit; a healthy probe
  closes it. Stale generation completions release capacity but cannot change state.
  The injected now function supports deterministic cooldown tests without sleeping.
- app.ts creates one gate per app instance, acquires only after request validation,
  classifies business conflicts as healthy reachability and releases in finally.
  Health/metrics routes remain independent of payment availability/capacity.
- payment-client.ts pay sets one performance.now deadline for all attempts. Remaining
  budget clamps AbortSignal.timeout for each fetch and its body reader. Backoff is
  allowed only if remaining time exceeds 50 ms, and the next loop rechecks budget.
  No Promise.race leaves an unbounded local fetch running. Remote completion remains
  uncertain on timeout, so key reuse and existing payment-side deduplication matter.
- resilience.test.ts tests fake-clock breaker transitions, stale completions, single
  probe, disabled-breaker capacity, threshold reset and invalid environment bounds.
  Real HTTP stubs hang before headers/inside body, verify responsive health and
  saturation, budget cancellation/capacity recovery, identical retry keys, no calls
  while open, shared backoff budget and non-retried business conflicts. Stub evidence
  is not presented as a live FastAPI payment measurement.
- apps/ai-engine/tests/test_graph.py adds a real 2.7-second hanging-source cancellation
  regression. Healthy branches survive and output remains PARTIAL within five seconds.
  Existing collector/worker production logic is retained after reviewing its limits.
- scripts/verify-p10-resilience.py launches real Express/FastAPI children on distinct
  loopback ports with memory storage and generated simulated orders. It observes
  real failure-driven opening, recovery-probe closure and total-budget expiry, then
  stops only its owned children. Its report contains safe flags/duration, no secrets.
  check.py integration now runs this short probe; CI uploads its safe summary.
- .env.example documents fake, nonsecret checkout limits. Historical P1 load, Demo
  observability, P10.2 quality and P8 sandbox profiles explicitly set circuit=false
  so sustained injected faults/recovery remain observable. This is a deliberate
  training override, not the default for ordinary checkout startup. Deadlines and
  capacity limits remain on in those profiles. Base development Compose retains
  default-enabled circuit behavior.

### Defaults and resource-bound review

| Setting                           | Default | Accepted range                 |
| --------------------------------- | ------: | ------------------------------ |
| PAYMENT_TOTAL_TIMEOUT_MS          |    4500 | integer 50–25000 ms            |
| PAYMENT_MAX_INFLIGHT              |      16 | integer 1–64                   |
| PAYMENT_CIRCUIT_ENABLED           |    true | literal true / false           |
| PAYMENT_CIRCUIT_FAILURE_THRESHOLD |       5 | integer 1–100 logical failures |
| PAYMENT_CIRCUIT_COOLDOWN_MS       |   10000 | integer 100–60000 ms           |

Existing payment attempts remain 1–2; per-attempt timeout remains 50–10000 ms.
A larger per-attempt timeout never bypasses the total deadline. Timer scheduling is
not hard real time; tests allow scheduling margin while requiring the smaller bound.
For a recovered HALF_OPEN probe, the existing maximum attempts still applies to that
one logical operation; one probe does not mean multiple callers can retry together.

Existing engine bounds reviewed: source wrapper 2.7 seconds; parallel graph 12 seconds;
optional local-model call eight seconds, 40 facts/16 KiB input, 768 output-token request
and 32 KiB envelope cap; knowledge child eight seconds; outer collector call 24 seconds,
worker 27 seconds and evidence lease 30 seconds. The internal collector admits at most
two active collections. These layers are retained; this task does not claim global
cluster limits, zero-cost inference or protection against arbitrary CPU-bound tools.

### Run/test

```powershell
npm run test --workspace=@sentinel/checkout-service
.venv\Scripts\python.exe -m pytest -c apps/ai-engine/pytest.ini apps/ai-engine/tests/test_graph.py -q
.venv\Scripts\python.exe scripts/check.py fast
.venv\Scripts\python.exe scripts/verify-p10-resilience.py
```

Focused checkout suite: 25 tests passed (17 existing plus eight new). Graph suite:
three passed, including the actual hanging-source cancellation. Full local fast
tier passed: checkout 25, API non-DB 43, React 20, payment 32, engine 51, scripts 20,
plus format/lint/control/build checks. Real isolated Express/FastAPI verification
passed: failure-driven opening/recovery, health/capacity recovery and total deadline
expiry observed in 0.437 seconds under a configured 400 ms budget (scheduling overhead
included). Fake dependencies are not substituted for this live probe.
Remote workflow conclusions are verified separately in GitHub Actions.
Positive: transient 503 then success returns 201 with the identical key. Negative:
hanging headers/body return budget 504 while an excess operation gets 503 and health
stays 200. Breaker open makes zero additional stub calls. No test result is inferred
from mocks alone: HTTP stubs, fake-clock state tests and real cancellation are labelled.

### Debug and security

PAYMENT_BUSY: check legitimate concurrency and downstream latency before raising the
limit. PAYMENT_CIRCUIT_OPEN: wait for cooldown and inspect failures/recovery; a health
200 only proves the checkout server is alive, not successful payments. Budget 504:
compare attempt/total limits and preserve the original idempotency key when retrying.
Thresholds can reject legitimate traffic during transient faults and must be tuned
with measured load. Circuit-generated 503s alter telemetry and may limit what current
deterministic hypotheses infer; P10.2 raw-fault profiles deliberately isolate that
experiment. Neither controls nor generated hypotheses authorize remediation.

No new secrets, external requests or browser-config values are added. Local payment
URL allowlists remain unchanged; hosted backend/private service networking is still
separate reviewed deployment work. Read documentation rather than resetting volumes
or silently disabling production safeguards to make a test pass.

### Manual setup

No new manual cloud setup required. Rebuild checkout before restarting it or rebuilding
an image; already-running processes keep their old code. Ordinary checkout startup
uses the defaults automatically. Optional validated settings belong to checkout's
process environment before startup, never browser configuration. Training helpers
intentionally override only the circuit flag. See MANUAL-SETUP.md for exact commands.
No cloud DB, Redis secret, model service or account change is needed for this task.

### Understanding check

1. Why does an attempt timeout differ from the total operation deadline?
2. Why must a timed-out payment retry keep its idempotency key?
3. Why must an old successful completion not close a newly opened circuit?

Exercise: in a temporary branch, set maxInflight=2 in a focused test and demonstrate
that two operations enter while the third receives PAYMENT_BUSY, then prove both
permits are released. Keep health independent of those operations.

### Commit summary

feat(P10.3): bound payment work with deadlines and circuit isolation.
Local checks completed before commit/push; configured account as sole author, no trailer.
P10.4 still requires its own explanation and approval.

## P10.4 — Secure configuration, redaction and audit review

### Concept → Architecture/data flow

Source scanning, redaction, authorization and audit integrity are different controls.
A scan can flag a public hash, while a valid token can still be dangerous if logged.
Use all four controls and document what each actually proves. Gitleaks runs locally
on an exported nonignored worktree and full reachable history; only safe metadata
is emitted. Real HTTP canaries check boundaries, then disposable PostgreSQL tests
exercise immutable audit policy. No request or credential is sent to a remote scanner.

### File plan → Approval checkpoint

User explicitly approved P10.4 including the pinned scanner, tests, audit review,
CI and docs. No schema/new public endpoint or production rewrite is needed after
review; add regressions to retain existing safe behavior. A CLI avoids introducing
a production dependency or an external code-upload service. Checksums protect the
selected bytes, not trust against a compromised publisher; official release provenance
and review are still important. Unsupported platforms fail rather than running an
unverified binary.

### Implementation → Walkthrough

- scripts/security_scan.py scanner() chooses a pinned Windows/Linux x64 archive and
  validates size/SHA256 before reading exact member bytes with binary_bytes(). It
  validates cached executable bytes too. No extractall or arbitrary command string.
- scan(tool,mode,target,output,source,log_opts) invokes argument arrays with a timeout,
  full redaction, explicit config/empty ignore file and no inline allow bypass. It
  accepts only completed clean/finding exit codes, checks consistency and returns
  rule/file/line/commit fields. Raw Match/Secret/line text never reaches the summary.
- main verifies positive/negative/path-scoped controls, checks tracked .env exclusions,
  copies only in-workspace nonignored regular files into an owned temporary directory,
  scans worktree/full refs, refuses shallow history and records measured coverage.
  Errors record FAILED/error_type. Findings make the command fail, not silently pass.
- .gitleaks.toml extends pinned defaults. Reviewed public hashes/migration filename
  exceptions require both exact values and specific paths for generic-api-key only.
  No commits/directories/provider rules are skipped. False positives and the initial
  failed control are documented in P10-SECURITY-REVIEW.md.
- scripts/tests/test_security_scan.py tests bad checksum refusal before execution,
  forbids archive extraction despite a traversal-shaped member, and refuses any
  unredacted finding before it can enter a safe summary.
- apps/api/test/security.test.ts uses real signed JWTs/Express/HTTP with explicit
  store doubles. It checks safe errors/logs, malformed/oversized input, no cross-origin
  read headers, invalid/disabled sessions and forbidden/extra-command approvals before
  any action-store call. No claim of real-DB coverage is made for that fixture.
- remediation-database-checks.ts adds normal-SQL immutability assertions for events,
  actions and recorded decision identity in the existing disposable cumulative suite.
  Privileged DB schema operators could bypass triggers; this is not a cryptographic
  chain. Existing migrations/production authorization stay unchanged.
- scripts/verify-p3.py now gives the combined compile/cumulative-test command a
  bounded 300 seconds instead of 120. On the slower local Windows run, the old
  wrapper timeout started fixture cleanup mid-suite, causing secondary DB errors.
  Application/individual test/knowledge deadlines are unchanged.
- ci.yml adds a full-checkout Linux Secret scan job and makes integration depend on
  it and fast tests. Only safe summary artifacts are uploaded. No repository secret,
  paid scanner license, source upload or history rewrite is required.
- Security/manual/progress documents provide exact commands, findings, role matrix,
  scope, caveats and pending hosted responsibilities.

### Run/test → Debug

Use the exact commands and measured outcomes in P10-SECURITY-REVIEW.md. Positive:
harmless scanner fixture passes and a real JWT can read permitted resources. Negative:
a generated never-issued token shape must trigger github-pat, checksum corruption is
rejected and VIEWER approval is denied. The real DB rejects audit mutations. Full local fast passed (25 checkout, 44 API
non-DB, 20 React, 32 payment, 51 engine, 23 scripts). The completed required-knowledge
cumulative run was 98 pass/two reported failures (knowledge assertion plus parent),
with all new audit assertions passing. No complete local knowledge pass is claimed;
see the security review for measured diagnostics and test-wrapper correction.

Scanner download/config failure is not a clean scan. Check the pinned asset/network
and safe error type; never disable rules to obtain green. Findings are metadata for
private review. A matching public hash needs narrow review, not a blanket exception.
Use the full-history checkout; partial history is rejected. Do not reset volumes,
rotate provider credentials without review or rewrite Git history as an automatic fix.

### Manual setup

No new manual cloud setup required. Run the helper with existing Python and Git; its
first verified download needs GitHub connectivity. Existing local DB/evidence stack
is needed only for the cumulative integration command. All provider/role/network/TLS,
backup and retention setup remains the hosted guide; no accounts are provisioned.

### Understanding check

1. Why can CORS restrictions never replace backend authorization?
2. Why does a reviewed public checksum need an exact path/value exception?
3. Why do immutable-row triggers not protect against a privileged schema owner?

Exercise: in a temporary local fixture, move a generated never-issued token-shaped
value into a reviewed public-hash path and show it is still detected. Do not commit
that value or test with a real provider token. Explain which rule caught it.

### Commit summary

feat(P10.4): verify secret hygiene and authorization audit boundaries.
Record only actually completed checks; configured account is the sole author.
P10.5 requires its own teaching plan and approval.

## P10.5 — Reproducible local demo

See [P10.5 complete task guide](P10-DEMO.md) for Concept → Architecture/data flow →
File plan → Approval checkpoint → Implementation → Walkthrough → Run/test → Debug →
Understanding check → Commit summary, exact Windows/Linux commands, preservation
boundaries and pending hosted responsibilities. User approval covered this task;
P10.6 has not been approved. Measured results are recorded separately in PROGRESS.md.

## P10.6 — Architecture, decisions and end-to-end communication

### Concept

Architecture explains components and boundaries; an ADR records a decision with
alternatives and costs; a demo script makes the operator's inputs, observations and
error paths repeatable. Portfolio wording ties claims to actual evidence. No new
technology or package is needed: Markdown, repository-native Mermaid diagrams and
existing source/test records are sufficient. Reusing local tooling avoids new
formatting/rendering or external publishing dependencies.

### Architecture/data flow

See [ARCHITECTURE](ARCHITECTURE.md): browser/API/PostgreSQL, durable outbox/Redis
worker, parallel read-only engine, saved evidence/knowledge and authenticated SSE.
Separate diagram: exact human decision → trusted executor → simulated sandbox →
measured audit. The walkthrough distinguishes main app, isolated experiment and
sandbox; it never claims those contexts are one automatically remediated incident.

### File plan → Approval checkpoint

The user approved the explained P10.6 plan, then requested the full working-feature
end-to-end instructions. Documentation-only scope: README, ARCHITECTURE, four ADRs
and their index, DEMO-WALKTHROUGH, PORTFOLIO, learning/manual/progress records and
clarification of startup instructions. No API/schema/runtime or dependency changes,
provisioning, real fault injection or remediation execution are part of this task.

### Implementation → Walkthrough

- README is the current entry point: setup, diagram, feature matrix, real measurement
  denominators, caveats and references. Earlier phase-specific commands remain in
  their learning guides instead of conflicting with current supervisor startup.
- ARCHITECTURE maps service/port/storage/authority boundaries and two diagram flows;
  source navigation links behavior to actual implementation files. It distinguishes
  graph execution from durable workflow state and trace export from trace querying.
- adr/README indexes the four retrospective decisions: outbox/queue/SSE; bounded
  read-only hypotheses; pgvector/exact provenance; human-approved sandbox. Every
  record states context, decision, alternatives, costs, failure/validation and revisit
  conditions. They explain why the code was chosen without inventing design history.
- DEMO-WALKTHROUGH provides exact terminals/commands, role matrix, healthy traffic,
  manual incident, async investigation, replay, source statuses, isolated fault tests,
  explicit sandbox image/preparation/decision/execution, shutdown and hosted checklist.
  It describes commands; writing the document does not execute the sandbox actions.
- PORTFOLIO provides optional honest bullets and a claim/evidence map. No claim of
  production impact, broad AI accuracy, public deployment or external publication.
- MANUAL-SETUP and the P10 learning guide link the authoritative operator path.
  P10-DEMO's numbered Windows setup is corrected for readable separate steps.
  PROGRESS records approval, actual checks, limitations and implementation completion
  separately from learner mastery, live model evaluation and hosting.

Important control flow remains the existing one: API acceptance persists work before
worker execution; independent async source reads join before ranking; backend checks
citations before saving; SSE replays durable events; executor authorization is a
separate recheck. No new functions, arguments, return types, async code or error
contracts were added by P10.6. The architecture/walkthrough explain those existing
boundaries rather than pretending documentation introduced runtime functionality.

### Run/test

Use `.venv\Scripts\python.exe scripts/check.py fast` and
`.venv\Scripts\python.exe scripts/security_scan.py` for existing regression/security
checks. Run Prettier explicitly on `docs/adr/*.md` too: the existing repository glob
only covers top-level docs. Relative documentation links/files are checked with an
owned local checker; positive known links must resolve and an intentional missing
link must be detected. Source paths, UI labels, state transitions and measured
denominators are cross-checked against source/phase evidence. Runtime and diagram
claims are scoped to the validation actually performed; Mermaid source review is
not a claim of browser rendering or fresh local integration. Actual results are
recorded in PROGRESS only after completion. Local docs QA does not operate your
development sandbox; existing CI uses its own disposable simulated action tests.

### Debug

Use DEMO-WALKTHROUGH's symptom table and existing ignored native logs. A stopped
Docker engine makes local DB/integration unavailable; it does not justify deleting
volumes or claiming a new pass from historical CI. A dead link is a documentation
failure, not an application outage. Fix its target/path; don't remove negative
controls to make QA pass. Use existing CI for a fresh Linux integration run and
record its exact revision. Public provider interfaces need review at setup time.

### Manual setup

No manual setup required for P10.6 documentation. To operate the project, start
Docker/Linux, run the launcher, sign in with your intentional account and prepare
optional sandbox/model work separately. Hosting/real model evaluation, learner
questions and independent exercises remain explicitly open; no external deployment
or paid resource is created by documenting the final implementation task.

### Understanding check

1. Which durable records survive a browser/worker restart, and why isn't LangGraph
   itself the crash-recovery store?
2. Why can't the six detected dependency faults establish general AI accuracy?
3. Why can a sandbox action be VERIFIED while its associated incident remains OPEN?

Exercise: draw the flow from Start investigation to one displayed source citation
without reading the diagram, then compare it with ARCHITECTURE. Add a local note
explaining one failure boundary in your own words and verify the referenced source.
Do not execute an action or put a secret in the exercise.

### Commit summary

`docs(P10.6): document architecture decisions and complete demo workflow`

Configured account only; no co-author trailers. P10.6 is the final task in the
current master plan. Software implementation completion does not complete the
learner checkpoints, hosted rollout, production remediation or optional model eval.
