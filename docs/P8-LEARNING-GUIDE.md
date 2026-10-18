# P8: human-approved sandbox remediation

Approval: the user approved P8.1–P8.5 and actual rollback tests restricted to a
separate disposable local sandbox. No production remediation or cloud deployment
is authorized. AI output and retrieved text never authorize an action.

## P8.1 — Catalog and policy

**Concept.** An allowlist defines the small set of supported operations. Least
privilege limits what each process can do. A dry run checks eligibility and
previews a change without executing it. We support one action, not arbitrary
commands: payment rollback inside `sentinel-remediation-sandbox`.

**Architecture/data flow.** Exact proposal body → UUID/action validation →
server-owned sandbox binding → service/status/version/image checks → dry-run
preview. The binding records the current container/image and the known-good
immutable target image. A mutable tag alone is not a trusted rollback target.

**File plan / implementation / walkthrough.** `remediation-policy.ts` defines
ACTION/SANDBOX constants, `SandboxBinding`, `parseProposal`, `assertBinding` and
`dryRun`. Proposal inputs contain only incident ID, idempotency key and action.
`parseProposal` rejects extra fields, unsupported actions and malformed IDs.
`assertBinding` requires exact sandbox name, full IDs, distinct immutable images,
known faulty source version and target payment-v1. `dryRun` rejects other services
and resolved/closed incidents. It returns a ten-minute approval window and
`execution_performed:false`. These synchronous functions do no I/O or execution.
The tests use synthetic image/container IDs; real Docker identity comes in P8.3.

**Approval checkpoint.** Covered by the user's full P8 approval.

**Run/test.** From `V:\sentinel\sentinel`:

```powershell
npm run build --workspace=@sentinel/api
node --test apps/api/dist/test/remediation-policy.test.js
```

Positive: the supported payment sandbox preview performs no execution. Negative:
wrong project/service/target, unchanged image, closed incident, commands, URLs and
unsupported actions are rejected. Actual test outcome recorded in PROGRESS.

**Debug.** ACTION_NOT_ELIGIBLE means check the incident and trusted binding;
do not accept an arbitrary target or weaken the policy to bypass it.

**Understanding check.** Why use image IDs instead of tags? Why reject extra
fields? Why is a dry run different from approval? Exercise: test a malformed
container ID and confirm no execution happens.

**Manual setup.** No manual setup required for P8.1. Docker and sandbox preparation
are required for P8.3. Hosted execution remains disabled and needs separate design
and authorization. **Commit summary:** `feat(P8.1): define sandbox rollback policy and dry runs`.

## P8.2 — Approval transactions and audit history

**Concept.** RBAC checks the current user's permissions. Idempotency replays one
request instead of creating another action. Row locks serialize competing
approval/rejection requests. A transaction commits the decision and both audit
histories together, or rolls all of them back. Approval expires ten minutes after
proposal creation; a replay does not extend it.

**Architecture/data flow.** Authenticated OPERATOR/ADMIN → exact proposal → trusted
sandbox registry binding → PENDING row + audit + incident event → authenticated
ADMIN decision → APPROVED/REJECTED + audit/event. Decision replay returns existing
state. Approval does not itself run Docker. Only one active proposal/attempt may
exist for the entire sandbox, enforced by a database unique index.

**File plan / implementation / walkthrough.** Migration 009 adds sandbox binding,
action and immutable event tables, foreign keys, state/expiry checks and a trigger
protecting proposal fields and valid status transitions. It adds REMEDIATION to
incident history without changing older migrations. `remediation-repository.ts`
uses short parameterized PostgreSQL transactions. `propose` checks live user,
incident, service and fresh binding, replays the request key, expires old work and
records PENDING. `decide` rechecks ADMIN, locks the action and records a first
unexpired decision once. `get` returns saved state and bounded ordered audit
history; `list` returns the latest 20 incident actions. `audit` writes action and
incident events in the same transaction. Errors roll back and return controlled
errors. `remediation-routes.ts` enforces media/body/UUID and backend permissions.
`app.ts`/`server.ts` wire these routes; `incidents.ts` validates new SSE history
payloads. No AI component is given a proposal/approval/execution tool.

API: POST `/api/v1/remediations/dry-run`, POST `/api/v1/remediations`, GET
`/api/v1/remediations/:id`, GET `/api/v1/incidents/:id/remediations`, POST
`/api/v1/remediations/:id/decision` with only `decision: APPROVE` or `REJECT`.
Proposal body has action, incident_id and idempotency_key only. Decisions require
ADMIN; reads require authentication; proposals/previews require incident-write
permission. Different decisions after the first do not reverse it.

**Approval checkpoint.** Included in the full P8 approval.

**Run/test.** `npm run build --workspace=@sentinel/api`, then
`.venv\Scripts\python.exe scripts/verify-p3.py --task P3.5 --with-evidence`.
Measured: 94 tests passed, zero skipped, with real PostgreSQL/Redis and existing
live collector. Positive: concurrent proposal replay shares one action;
concurrent ADMIN approvals produce one decision event. Negative: viewer/operator
approval, extra command fields, active conflicts, immutable binding changes,
audit deletion and revoked ADMIN permissions are rejected. Rejection stays
terminal; incident history reads the new events. Initial fixture compilation
exposed a wrong assumption about createUser's return value; corrected UUID usage
and the complete verifier passed, including restart/outage checks.

**Debug.** ACTION_CONFLICT means finish/reject the existing proposal. A stale or
missing sandbox binding needs explicit preparation. Do not grant ADMIN merely
to bypass 403. Inspect events and expiry before retrying a decision. Database
failure must not leave a decision without its audit record.

**Understanding check.** Why is a unique index needed as well as API validation?
Why must decision and audit commit together? Why not renew expiry on replay?
Exercise: add a concurrent approve-versus-reject test and assert only one wins.

**Manual setup.** No cloud account required. Apply migration 009 through the local
supervisor. Sandbox registration comes in P8.3. Your interactive account needs
ADMIN only if you want to approve tests yourself; it is never silently promoted.
Hosted API runtime grants and private executor provisioning are deferred.
**Commit summary:** `feat(P8.2): persist human decisions and atomic action audits`.

## P8.3 — Restricted local executor and real rollback

**Concept.** A rollback replaces the faulty runtime with an exact previously
verified image. A tag can move, so setup resolves local image IDs and proves a
good baseline before recording a target. A process with Docker access is powerful:
our restrictions are application policy, not an OS security boundary against a
compromised local administrator or executor host.

**Architecture/data flow.** Explicit sandbox setup → good payment image and
checkout baseline → faulty payment image → server-owned binding + local trusted
config → ADMIN-approved DB row → independent executor → identity/auth recheck →
fixed Compose operation replacing only sandbox payment → saved observations.
The executor is a separate manually started process. No HTTP/AI tool exposes Docker. Native development processes share one OS
account; this is application separation, not OS-level Docker permission isolation. PostgreSQL is the durable
work source: APPROVED records wait for this executor even across API restarts.
No additional queue is needed for this one-active-sandbox workflow.

**File plan / implementation / walkthrough.**

- `compose.sandbox.yaml`: separate project/network, loopback 4301/4302, pinned
  images from ignored `.env.sandbox`, memory-only simulated payments, no DB or
  host mounts, read-only roots, dropped capabilities and no-new-privileges.
- `sandbox_support.py`: Docker calls are argument arrays with no shell, fixed
  project/file and explicit local context. Docker receives an environment
  allowlist excluding application secrets and Docker host overrides. Context
  inspection rejects remote engines. `assert_container` checks labels, exact
  container/image, ports, storage and hardening. `write_images` accepts full image
  IDs only. `load_config` checks the normalized Compose hash. `probe` and
  `wait_version` inspect fixed loopback endpoints. Command timeout is 35 seconds;
  runtime identity wait is bounded to 20 seconds.
- `sandbox-local.py`: rejects remote API DB targets. Under a file lock and short
  DB advisory lock, it refuses active main proposals and removes old registration
  before preparation. It resolves the allowlisted local images, verifies payment
  image labels/non-root user, runs good-version synthetic checkout checks, then
  observes the deliberate faulty version. Finally it records current container,
  current/target image IDs and a local Compose fingerprint. Missing setup makes
  proposals fail closed. No persistent demo data enters the sandbox.
- `sandbox_executor.py`: `claim` locks approved state, rechecks live ADMIN role,
  enabled/token version, incident eligibility, expiry and exact trusted binding.
  It commits EXECUTING with a fresh execution token and audit before mutation.
  `execute` verifies the actual container and checks authorization again just
  before the fixed Compose operation. A local file lock serializes setup and all
  executor instances. `finish` fences terminal persistence by token/status.
  Duplicate delivery cannot claim EXECUTING or terminal rows. No automatic retry
  occurs after the external command may have started. DB and Docker cannot share
  one atomic transaction: a crash leaves EXECUTING requiring explicit review.
- `reconcile` only marks an abandoned attempt UNVERIFIED after two minutes and
  after acquiring the same process lock. It performs no Docker mutation.
  `--watch` polls durable approved work; `--action` handles one UUID. Neither
  option grants permission to an unapproved row. A stopped executor leaves work
  waiting rather than pretending approval executed it.
- `remediation-sandbox-scenario.ts` and `verify-p8.py`: a disposable API database,
  temporary HTTP server and test-only ADMIN/OPERATOR/VIEWER accounts exercise real
  authentication, policy, approval, Docker rollback and replay. Secrets remain in
  process memory/ignored test artifacts; your existing account is untouched.

**Approval checkpoint.** Actual sandbox rollback explicitly authorized in the P8
approval. Only the separate simulated service may change.

**Run/test.** Build the API before running the verifier:

```powershell
npm run build --workspace=@sentinel/api
.venv\Scripts\python.exe scripts/verify-p8.py
.venv\Scripts\python.exe -m pytest scripts/tests/test_remediation.py -q
```

Expected real scenario: unapproved call NO_EXECUTION; ADMIN approval; faulty
sandbox changes to exact payment-v1; saved VERIFIED observations; duplicate call
NO_EXECUTION; incident remains OPEN. Audit order is PENDING, APPROVED, EXECUTING,
VERIFIED. The verifier drops only its uniquely named temporary API DB, retains
sandbox containers, and never resets persistent demo/API databases. Unit fixtures
exercise remote engine rejection, dangerous image strings, wrong container/
project, privileged mounts/ports and no mutation for an unapproved claim. Actual
outcomes are recorded in PROGRESS.

**Debug.** Preparation needs the three existing allowlisted local images and free
4301/4302. If missing, use the documented P2 image-build process; never substitute
an arbitrary image. A stale config/changed current container requires a fresh
proposal, not editing approval bindings. The payment deployment ID must be a UUID;
initial setup used an invalid marker and failed before the working UUID fixture.
The first scenario build also exposed the auth-key Uint8Array requirement; fixed
before executing the accepted scenario. Don't hide build errors with stale output.

**Understanding check.** Why record EXECUTING before Docker? Why not automatically
retry after a timeout? What does the file lock protect that a database transaction
cannot? Exercise: test that a changed container ID fails before Compose mutation.

**Manual setup.** Docker Desktop with Linux containers and existing P2 images are
required. Run `scripts/sandbox-local.py` to create a fresh faulty sandbox before
an interactive proposal. Use the localhost controls to propose/approve, then run
`.venv\Scripts\python.exe scripts/sandbox_executor.py --action ACTION_UUID`, or
start `--watch` in a separate terminal. Stop it with Ctrl+C. An ADMIN account is
required to approve; account roles are never silently changed. Cloud setup can
wait. Never expose this executor or Docker daemon publicly.
**Commit summary:** `feat(P8.3): execute only approved isolated sandbox rollbacks`.

## P8.4 — Recovery windows and conservative results

**Concept.** A command exit is not recovery. Readiness proves only a narrow
condition. We require the approved image/version and several valid synthetic
checkouts over time; missing observations remain uncertainty. VERIFIED means the
sandbox passed this bounded check, not a proven root cause or long-term recovery.

**Architecture/data flow.** Fixed rollback → bounded version wait → target-image
inspection → ready/version responses and three checkout samples spaced one second
apart → same container/image inspection again → classify → fenced result/audit.
The operational incident is never resolved automatically.

**File plan / implementation / walkthrough.** `remediation_verification.py`
contains pure `classify(observations)`: exact boolean/numeric checks and bounded
sample/window sizes. All identity/readiness checks plus 3/3 successful samples
and >=2 seconds are required for VERIFIED. Conclusive unhealthy responses or a
failed command with the unchanged original container yield FAILED. Missing,
malformed or incomplete observations and ambiguous timeouts yield UNVERIFIED.
`probe` in sandbox_support uses fixed loopback URLs, verified response shapes,
unique synthetic order/request IDs, at most three samples, two-second HTTP limits,
16 KiB response bounds and no redirects/proxy inheritance. It verifies simulated
memory storage, service/deployment/version/fault mode and exact payment response
fields. `sandbox_executor` rechecks container identity after the window and uses
the classifier. It never retries an external effect after timeout. If result
persistence fails, the durable EXECUTING record requires explicit reconciliation.
`scripts/tests/test_recovery.py` checks missing/short/invalid measurements, partial
checkout failure, failed command and ambiguous timeout with no command retry.
These failure fixtures are synthetic; actual success uses Docker/HTTP.

**Approval checkpoint.** Covered by full P8 approval.

**Run/test.** `.venv\Scripts\python.exe -m pytest scripts/tests -q` passed six tests.
The real `scripts/verify-p8.py` scenario passed with three successful checkout
samples over 2.781 seconds, exact target image/version, durable VERIFIED result,
NO_EXECUTION on duplicate and an OPEN incident. The final phase verifier reruns
all integration after security additions. Earlier tests without a time window do
not substitute for this measured result.

**Debug.** FAILED is a measured failure at the checked boundary; inspect its code
and observations. UNVERIFIED must not be displayed as success. A CLI timeout can
leave Docker working after the client exits, so inspect/reconcile rather than
repeat. An abandoned EXECUTING action older than two minutes can be marked
UNVERIFIED with `sandbox_executor.py --action ACTION_UUID --reconcile`; the shared
lock must be free. This command never performs another Docker mutation.

**Understanding check.** Why can readiness succeed while checkout fails? Why is
UNVERIFIED different from FAILED? What does a two-second successful window fail
to prove? Exercise: add a classifier test for too few successful samples.

**Manual setup.** No additional manual setup required beyond P8.3. No metrics
vendor account is needed: these are direct sandbox probes, not a claim that the
sandbox has a production monitoring integration. Hosted recovery/SLO checks need
separate environment-specific work. **Commit summary:**
`feat(P8.4): verify bounded recovery and classify uncertain outcomes`.

## P8.5 — Security review, adversarial tests and local controls

**Concept.** A proposal is data; authorization is a backend decision tied to an
identity and an immutable action. Even plausible AI advice cannot grant access.
Replay, SSRF and command injection require architectural boundaries, not keyword
filters. A crash between database and Docker is an uncertainty to record.

**Architecture/data flow.** Browser sends a fixed action/incident/key, not a
command. Backend records an immutable proposal; an ADMIN reviews the exact saved
binding and decides; the independent executor rechecks current authorization and
runtime scope. Observations, not model text, determine the recorded result.
The original incident history/SSE carries action changes; report synthesis and
knowledge retrieval do not gain any write capability.

**File plan / implementation / walkthrough.** `P8-THREAT-MODEL.md` lists threats,
controls, tests and residual trust assumptions. Migration 010 additively strengthens
009 with decision/start links and immutable decision/execution identities; applied
migrations are not edited. API responses omit internal execution tokens and user
token versions. The executor also validates checkout's exact image/project/ports,
fixed payment URL and no mounts. A terminal attempt invalidates its matching
sandbox registry binding so subsequent proposals require explicit fresh setup.
The verifier removes only its own matching temporary main registration.

`auth-test.html/js` adds dry run, proposal, saved action/audit, explicit review
checkbox, ADMIN approve/reject and incident list. Changing the action ID clears
review; approval requires the exact loaded pending proposal and checkbox. Backend
permissions remain authoritative even if a client changes the UI. Responses use
textContent; tokens remain memory-only. An uncertain decision response instructs
loading saved state before retry. Approving never directly calls Docker from HTTP.

`remediation-database-checks.ts` tests expiry and atomic rollback when audit insert
fails. `remediation-sandbox-scenario.ts` tests actual HTTP RBAC/schema rejection,
reject/no-execution, concurrent approval/executor delivery, terminal replay, hidden
internal tokens and live executor cancellation for expired/demoted/disabled/reset/
changed-binding/forged-viewer fixtures. A stale container fails before mutation.
Synthetic approved rows in this disposable DB model adversarial persisted state;
they are not real human decisions. The normal success path uses actual HTTP
login and ADMIN approval under the user's explicit sandbox-test authorization.
An abandoned EXECUTING fixture demonstrates no-mutation reconciliation and
immutable execution tokens. `verify-p8.py` compares all non-sandbox container
IDs/images/states before/after; it drops only its own randomly named DB.

**Approval checkpoint.** Included in approved P8. No production/cloud action.

**Run/test.** From `V:\sentinel\sentinel`:

```powershell
npm run build --workspace=@sentinel/api
$env:TEST_KNOWLEDGE_REQUIRED="1"
.venv\Scripts\python.exe scripts/verify-p3.py --task P3.5 --with-evidence
.venv\Scripts\python.exe scripts/verify-p8.py
.venv\Scripts\python.exe -m pytest scripts/tests -q
npm run test:engine
npm run test:payment
npm run test --workspace=@sentinel/checkout-service
npm run format:check
```

Run the Docker verifiers sequentially: the outside-container stability assertion
would correctly notice another verifier starting/stopping unrelated containers.
The main API/collector and local knowledge/observability stack must be running for
live-evidence checks. Actual final results are in PROGRESS and the measured record
below. Unit failure fixtures are distinguished from real Docker success tests.

**Debug.** Never respond to a failed security check by adding arbitrary command,
URL, actor or image overrides. Rebuild before the scenario; TypeScript failures
must stop execution. A test server must remain asynchronous while invoking the
executor, or HTTP keep-alive tests can fail independently of rollback. A complete
scenario is accepted only after it reruns successfully. Credentials/test tokens
are not printed. Inspect ignored p8-failure.log locally if a scenario fails.

**Understanding check.** Why does the backend ignore claimed roles in a body?
Why can't a retrieved document approve a change? What remains uncertain after a
Docker client times out? Exercise: add a rejected metadata-service URL proposal
and assert no action/audit row is created.

**Manual setup.** Follow MANUAL-SETUP's P8 checklist for Docker, local ADMIN account,
explicit sandbox preparation, private executor startup, reviewed approval,
verification and clean shutdown/reconciliation. No new cloud account is needed.
A public production executor is outside this phase; HOSTED-SETUP documents the
remaining boundaries and review requirements. **Commit summary:**
`test(P8.5): harden action authorization and verify sandbox boundaries`.

System/executor audit events have a null actor_id; decided_by on the immutable
action identifies the approving human. The executor must not impersonate that
human as the person who performed a later automatic check or reconciliation.
Native development shares the OS user and Docker trust; hosted OS separation is
explicitly pending. The matching sandbox registry is invalidated on terminal
execution so another proposal cannot reuse a stale runtime preview.

Final concurrency review: the verified JWT's internal version and expiry are
carried to the action transaction. After locking the live user, proposal/decision
checks compare that captured version and DB-clock session expiry again. This
closes a password-reset/expiry race between middleware authentication and a
blocked transaction. These internal fields are not added to public profiles.
The saved approval then has its own proposal expiry; ordinary JWT expiry after
a valid decision does not silently revoke that approval. Account disable, role
demotion and token-version reset are still checked by the executor before dispatch.

## Final measured record

P8.1–P8.5 local software is complete. Final API regression: 95 passed, zero
skips/failures, actual PostgreSQL/Redis and live retrieval required. Other suites:
46 engine, 32 payment, 17 checkout and 9 executor/recovery/security unit tests
passed. The real sandbox scenario uses HTTP login/RBAC and actual Docker, with
only simulated memory payments and disposable verifier accounts/database. It
passed 3/3 checkouts over 2.672 seconds, correct runtime identity, one competing
verified attempt, no duplicate execution, all nine adversarial/reconciliation
checks and no outside-container changes. Incident status stayed OPEN.

Formatting, Python lint and dependency checks are recorded in PROGRESS. Runtime
migrations are additive through 010. A separate P7.3 follow-up corrected a measured
5.58s local cold start by retaining a bounded eight-second retrieval budget and
outer 24/27s limits inside the 30s lease; required-live regressions passed afterward.
No cloud resource, production rollback, external payment or chat-model inference
was performed. Learner checkpoints are not marked complete without your answers.

The local lock uses `filelock`, already pinned through the P7 engine requirements,
so Windows/Linux use their supported process locks. A persistent lock filename is
not permission to delete a live lock; OS process lifetime controls ownership.
For interactive testing, explicitly use your own ADMIN account and the manual
sandbox/executor checklist. Existing account roles were not silently modified.
'Maintaining public access' still requires the deferred hosting work; the current
app and executor remain local and the executor remains sandbox-only.
