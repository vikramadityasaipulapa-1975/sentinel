# Sentinel manual setup checklist

P1–P9 are implemented locally. For provider-specific cloud database steps,
read [HOSTED-SETUP.md](HOSTED-SETUP.md). No external deployment or paid resource
has been created. Keep credentials in ignored configuration or a secret manager;
never paste them into chat or Git.

## What is already automated locally

The local launcher prepares three retained PostgreSQL/Redis services, applies
pending migrations, preserves accounts/incidents, provisions the restricted
history reader and starts the API, worker and evidence service. P4's separate
supervisor runs the monitored demo and collectors. These are development/test
services, not public hosting. No LLM key or model subscription is required for P5.

Ignored `.env.api` contains primary API/queue secrets; `.env` contains the separate
demo DB settings; `.env.evidence` contains the reader and collector settings. The
Python engine receives no main DB credentials. Local deployment history remains
EMPTY until a real versioned deployment is recorded through P2's workflow.

## Restart locally: exact order

First start Docker Desktop with Linux containers. Use Node 24/npm 11 and Python
3.11. If services are already running, use the open page; do not launch duplicates.
From a PowerShell terminal:

```powershell
Set-Location V:\sentinel\sentinel
npm ci
# Only if the virtual environment does not yet exist:
# py -3.11 -m venv .venv
.venv\Scripts\python.exe -m pip install -r services/payment-service/requirements.txt
.venv\Scripts\python.exe -m pip install -r apps/ai-engine/requirements.txt
.venv\Scripts\python.exe scripts/init-local.py
npm run build
.venv\Scripts\python.exe scripts/api-local.py
```

`init-local.py` preserves an existing `.env`. The API launcher starts only the demo
**database**, not another payment/checkout process. It applies the unchanged P2
migrations, prepares the reader, applies pending API migrations including 006 and 007 and starts owned API,
engine and worker children. Expected API log: `listening` on 3000; worker mode:
`deterministic-evidence`. Keep this terminal open.

In a second terminal:

```powershell
Set-Location V:\sentinel\sentinel
.venv\Scripts\python.exe scripts/observability-local.py
```

This uses memory-only demo payments and creates no verified release records.
Ctrl+C stops each supervisor's owned processes. Retained volumes stay available;
do not use `down -v` as a debugging shortcut.

Check readiness and open the page:

```powershell
(Invoke-WebRequest http://localhost:3000/ready).StatusCode
(Invoke-WebRequest http://localhost:8001/health).StatusCode
(Invoke-WebRequest http://localhost:9090/-/ready).StatusCode
(Invoke-WebRequest http://localhost:3100/ready).StatusCode
Start-Process http://localhost:3000/auth-test
```

Expected: all 200. Engine health confirms the process, not collector availability.
Missing collectors produce explicit evidence source failures/PARTIAL results.

## Test an investigation yourself

1. Sign in on `/auth-test` with your existing local account; there are no defaults.
   Reload clears the page's token from memory.
2. Click **Services** and copy a service UUID. Create a clearly named `DEMO:`
   incident using an OPERATOR or ADMIN account, or use an existing open incident.
3. Copy its incident UUID into the investigation form. Generate a new request key.
4. Click **Watch progress**, then **Enqueue investigation**. This creates real
   local data. Retry an uncertain submission with the same key.
5. Click **Investigation status**, then **Saved evidence**. Expect four snapshots,
   source statuses, exact windows/locators, normalized data and `hash_verified: true`.
   PARTIAL is normal when releases/logs are absent or metric coverage is sparse.
6. Click **Hypothesis report** after completion. It lists ranked possible causes,
   exact cited facts/snapshot IDs/hashes, contradictions and limitations. Default
   mode is deterministic with `ai_performed: false`; it does not claim a live model
   ran. Insufficient evidence can produce no hypotheses. Historical P5-only runs
   legitimately have no report (404).
7. To rerun, generate a new key after the first run finishes. Earlier investigation
   UUIDs retain their original snapshots. **Next evidence page** follows a scoped
   cursor if more records exist. Investigations currently compare the previous
   five minutes with the latest five minutes at worker execution time; they do
   not claim to reconstruct an old incident outside collector retention.
8. Negative permission check: a VIEWER can inspect saved evidence but cannot
   enqueue an investigation (403). An anonymous protected read returns 401.

The page is a testing interface; the full dashboard is a later phase. Source
values render as text, never executable HTML. No automated remediation happens.

## Repeat automated checks

```powershell
.venv\Scripts\python.exe -m pytest -c apps/ai-engine/pytest.ini apps/ai-engine/tests -q
.venv\Scripts\python.exe scripts/verify-p5.py
.venv\Scripts\python.exe scripts/verify-p5-deployments.py
.venv\Scripts\python.exe scripts/verify-p3.py --task P3.5 --with-evidence
```

The first command uses controlled fixtures. The second reads real collectors.
The third uses real PostgreSQL and synthetic releases in an isolated disposable
DB. The last runs the full API/DB/Redis suite plus live Python collection and
worker persistence, then API/DB/Redis restart checks in isolated containers.
It does not reset the main application DB. Docker must be available on PATH for
Compose plugins; open a new terminal after installing Docker Desktop if needed.
Reports stay ignored under `.artifacts`; task-specific measured results are in
PROGRESS.md. Sandboxed Python startup may stall on this Windows host; use your
normal terminal for these commands rather than launching duplicate test runs.

## If something fails

- Port occupied: stop the existing supervisor with Ctrl+C, not arbitrary Python or
  Node processes. The API helper refuses occupied ports to avoid duplicate workers.
- API 503: check the main DB and migration completion before re-entering passwords.
- Engine missing: check port 8001 and the launcher's safe error output. Do not copy
  its key into browser requests; only the worker calls it.
- PARTIAL: inspect individual source status/coverage; EMPTY is not a healthy-zero
  measurement. Start collectors or select a fresh observation window as appropriate.
- FAILED with EVIDENCE_COLLECTION_FAILED: check the worker/engine matching secret
  and engine URL/health. The system retries within its three-attempt budget and
  never substitutes a successful workflow check for a rejected evidence call.
- Reader UNAVAILABLE: rerun the local launcher to check migrations and reader
  provisioning. Never substitute the monitored database owner credential.
- Hash check failure: preserve the record and investigate integrity; do not edit
  immutable snapshots to suppress the error.

## Optional real local model setup (can wait)

No model is required for deterministic reports, fixture tests or continued local
project development. No live model was installed or run by the agent. To enable
real local model-assisted ranking later:

1. Install [Ollama](https://ollama.com/download) yourself and choose a local model
   tag appropriate to your RAM/GPU and license. Model selection and download are
   manual; no specific size is assumed to fit your computer.
2. Quit any existing Ollama tray/server instance before starting another. In a
   dedicated PowerShell terminal, start it with cloud routing disabled:

   ```powershell
   $env:OLLAMA_NO_CLOUD='1'
   $env:OLLAMA_HOST='127.0.0.1:11434'
   ollama serve
   ```

   Keep this terminal running. These settings must apply to the **Ollama server**,
   not only Sentinel. Do not re-enable cloud routing. See
   [Ollama's cloud-disable instructions](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features).

3. In another terminal, replace the placeholder below with your chosen **local**
   model tag (not a cloud tag), download it and check the installed list:

   ```powershell
   ollama pull YOUR_LOCAL_MODEL_TAG
   ollama list
   ollama run YOUR_LOCAL_MODEL_TAG "Reply with OK."
   ```

   The download contacts the model registry; no Sentinel telemetry is included.
   Warm-up helps with cold-start latency. Our model call has an eight-second
   deadline, so measure suitability rather than assuming any model will fit.

4. Stop the Sentinel local supervisor with Ctrl+C. Edit the ignored
   `V:\sentinel\sentinel\.env.evidence` without deleting its existing credentials.
   Add/update these four lines; never put secrets or real configuration in Git:

   ```dotenv
   SENTINEL_LLM_PROVIDER=ollama
   SENTINEL_LLM_URL=http://127.0.0.1:11434
   SENTINEL_LLM_MODEL=YOUR_LOCAL_MODEL_TAG
   SENTINEL_LLM_LOCAL_ONLY=1
   ```

   The last flag confirms you disabled server-side cloud routing. It does not
   itself configure Ollama. Sentinel also rejects cloud-labelled model names and
   remote model endpoints, but cannot independently verify every server alias.

5. Restart `scripts/api-local.py`. It preserves these explicit model settings and
   passes them only to the internal engine. Enqueue a fresh investigation and
   inspect its report. `model_status: OK` and `ai_performed: true` identify a
   validated model-assisted result. TIMEOUT/INVALID/UNAVAILABLE retain explicit
   limitations and deterministic suggestions; they are not successful AI analysis.
6. To disable again, set `SENTINEL_LLM_PROVIDER=disabled` in the ignored file and
   restart. Never paste a provider key or connection string into chat.

Remote inference needs a separately reviewed provider adapter, cost/data-policy
choice and authorization to transmit selected evidence. A local HTTP URL alone
must not be assumed to prevent a model server from forwarding requests.

## P6 workflow and evaluation commands

```powershell
.venv\Scripts\python.exe scripts/verify-p6.py
.venv\Scripts\python.exe scripts/evaluate-p6.py
```

The first reads actual local sources through sequential and parallel workflows,
with no model inference. The second evaluates ten synthetic labelled scenarios
with the deterministic baseline. See [P6-EVALUATION.md](P6-EVALUATION.md) for
measured errors and denominators. Neither command mutates monitored services.
After optional local model setup, `scripts/evaluate-p6.py --local-model` runs a
separate model-on-fixtures comparison; it does not establish real-world accuracy.
No model or cloud setup is required for the default commands.

## Manual cloud responsibilities

A cloud PostgreSQL DB stores application records; it does not replace hosted API,
worker, Redis, metrics, logs or traces. Follow [HOSTED-SETUP.md](HOSTED-SETUP.md) for
Neon creation, secure connection settings, owner/runtime separation, exact SQL
grants, deployment-reader setup, Render process types and verification.

Remaining deployment work includes host/port binding, private transport policy,
remote service/admin bootstrap, monitored release recording, selected vendor
collector authentication, HTTPS/SSE ingress and backup restoration tests. The
current code intentionally remains loopback-only. Creating the cloud DB is a
preparation step; it does not make Sentinel publicly reachable.

## P7: local knowledge preparation and later hosted setup

Cloud setup can still wait. The working development stack uses a separate
knowledge database on loopback 55436, in addition to the existing incident DB.
Knowledge stores runbook passages/vectors; it does not collect telemetry itself.

On a fresh machine, from `V:\sentinel\sentinel`:

1. Install the pinned embedding dependencies:
   `.venv\Scripts\python.exe -m pip install -r apps/ai-engine/requirements.txt`.
2. Start Docker Desktop with Linux containers. Run
   `.venv\Scripts\python.exe scripts/knowledge-local.py`. It creates ignored
   `.env.knowledge`, a retained pgvector volume, migration ledger, reader role,
   downloads hash-pinned model artifacts if missing, and ingests reviewed files.
   Expect twelve documents/72 passages initially, zero newly inserted passages on
   a repeat. Do not delete existing credentials or volumes to repeat setup.
3. Run `.venv\Scripts\python.exe scripts/verify-p7.py`. It creates/removes only a
   uniquely named test DB, verifies real embeddings/pgvector and prints no secrets.
4. Stop the existing API supervisor with Ctrl+C, then run
   `.venv\Scripts\python.exe scripts/api-local.py`. Migration 008 is additive.
   Only the knowledge reader URL is passed to the engine. No model/owner/main-DB
   credentials are added to the browser.
5. Open `http://localhost:3000/auth-test`, log in using your own account, create or
   select an incident and enqueue a new investigation. Read the saved report.
   `knowledge.status: OK` has exact source/version/section/range/hash citations.
   EMPTY means no qualifying passage; UNAVAILABLE is a bounded retrieval failure;
   DISABLED means the process has no reader configuration. Existing reports do
   not change automatically. Embeddings run locally; the chat model remains off.
6. To stop only the development knowledge container while preserving data:
   `docker compose --env-file .env.knowledge -f infrastructure/compose.knowledge.yaml stop`.
   Restart using the setup helper. Never run `down -v` on persistent databases.

No further user action is needed to continue local development once these checks
have been performed. A successful local run does not provide public access.

For a later public deployment, first choose provider/region/budget and approve the
hosting work. Then follow HOSTED-SETUP plus its P7 additions: private pgvector
provisioning/roles, migration/ingestion, packaged source/model artifacts, engine
reader secret and runtime table grants. Keep connection strings in provider
secret settings. Do not paste them in chat. Accounts, billing, public DNS/TLS,
hosted API/worker/Redis/collectors and recovery verification remain manual work
until a separately approved deployment is actually performed.

## P8: human-approved local sandbox actions

P8 local software can be used without cloud setup. It changes only a separate
memory-only simulated payment sandbox, never the existing payment/demo DB or a
production service. Do not treat its VERIFIED result as a root-cause diagnosis.

1. Keep Docker Desktop (Linux containers), API/worker/engine, knowledge DB and
   observability running. From `V:\sentinel\sentinel`, install existing pinned
   requirements/dependencies if this is a fresh checkout, then build:

   ```powershell
   npm run build --workspace=@sentinel/api
   .venv\Scripts\python.exe scripts/api-local.py
   ```

   The helper applies migrations 009 and 010 without resetting data. If the API
   is already running with these changes, do not start a second copy on 3000.
   The existing P2 images payment-v1, payment-v3-error and checkout local-p2 must
   exist; preparation refuses missing/unrecognized images instead of downloading
   an arbitrary substitute. See the P2 guide for the approved image build process.

2. If you want to approve actions yourself, use your own ADMIN account. No default
   ADMIN or password is created. In an interactive terminal, choose one:

   ```powershell
   .venv\Scripts\python.exe scripts/api-user.py create --email YOUR_EMAIL --role ADMIN
   # Or explicitly change your existing account's role:
   .venv\Scripts\python.exe scripts/api-user.py role --email YOUR_EMAIL --role ADMIN
   ```

   ADMIN can approve/reject backend actions, so grant it only intentionally. The
   create command prompts for a hidden password; never put it in commands/chat.
   Sign in again after account changes. Your account was not silently promoted
   by the implementation or tests; verifier accounts exist only in disposable DBs.

3. Prepare a new disposable faulty sandbox before proposing:

   ```powershell
   .venv\Scripts\python.exe scripts/sandbox-local.py
   ```

   It checks good-version synthetic payments, introduces payment-v3-error and
   registers exact image/container identities. Ports 4301/4302 must be free.
   `.env.sandbox` and `.artifacts/p8-sandbox.json` are ignored. Preparation refuses
   active main proposals; reject a pending proposal or inspect an active attempt
   first. The existing monitored demo remains on 3001/3002.

4. In a separate trusted terminal start the executor explicitly:

   ```powershell
   .venv\Scripts\python.exe scripts/sandbox_executor.py --watch
   ```

   Leave it running for durable APPROVED work, or omit the watcher and run one
   explicit `--action ACTION_UUID` after approval. The regular API helper never
   starts a privileged executor automatically. Native local processes share your
   OS account: application separation is not OS-level Docker permission isolation.

5. Open `http://localhost:3000/auth-test`. Sign in, obtain the payment service UUID
   using Services and create/select an OPEN payment incident. In the sandbox
   section enter that incident UUID. Click Dry-run, inspect the fixed sandbox/
   current container/current image/target image, then Propose. Reuse the proposal
   key if a response was uncertain; New proposal key starts a different request.
6. Load the exact pending action and audit. As ADMIN, review its immutable binding,
   check the explicit review box and Approve; or Reject. VIEWER cannot propose or
   decide, OPERATOR may propose but cannot decide. Backend authorization remains
   enforced even if someone edits the page. Approval expires ten minutes after
   proposal creation and does not extend on retry.
7. Watch the incident history/SSE or reload action/audit. Expect EXECUTING then
   VERIFIED only after correct runtime identity and 3/3 valid synthetic checkout
   responses over >=2 seconds. FAILED is a measured failure; UNVERIFIED means
   insufficient/ambiguous evidence. The incident remains open for human judgment.
   The matching sandbox registry binding is invalidated after a terminal attempt;
   prepare a fresh sandbox before another proposal.
8. Stop the executor with Ctrl+C. If stopped during an attempt or a crash left
   EXECUTING, inspect actual sandbox state. After two minutes, with no live
   executor holding the shared lock, record uncertainty without repeating rollback:

   ```powershell
   .venv\Scripts\python.exe scripts/sandbox_executor.py --action ACTION_UUID --reconcile
   ```

   Do not delete the lock file to bypass a live owner. Reconciliation never runs
   Docker mutation. A DB/Docker timeout is not permission to repeat the action.

9. To stop only the disposable sandbox while preserving every persistent DB:

   ```powershell
   docker compose --project-name sentinel-remediation-sandbox --env-file .env.sandbox -f infrastructure/compose.sandbox.yaml stop
   ```

   Do not use broad Docker cleanup or delete volumes. To repeat the automated real
   test, build then run `npm run verify:p8`; it uses an owned temporary API DB,
   verifies outside containers stay unchanged and leaves no interactive ADMIN.

Cloud setup can still wait. For public deployment, keep this sandbox executor
private/off until a separate hosting/security review. A cloud DB alone does not
provide the executor, API/worker, Redis, collectors, TLS or account bootstrap.
See HOSTED-SETUP's P8 section for pending role/host boundaries.

## P9 dashboard: use the application without copying UUIDs

No new account, cloud DB or paid service is needed. Existing accounts and records
remain valid. On a fresh pull run npm ci once to install the pinned web dependencies.

1. Start Docker Desktop and wait until docker info succeeds with Linux containers.
2. From the repo root start knowledge-local.py --database-only, then keep
   api-local.py and observability-local.py in their separate terminals as before.
3. For the built same-origin dashboard:

   ```powershell
   npm run build --workspace=@sentinel/web
   npm run build --workspace=@sentinel/api
   ```

   Restart only the existing API supervisor to load new server code, then open
   http://localhost:3000/dashboard/. Do not launch a second supervisor on 3000/8001.

4. For development instead, leave the backend running and run npm run dev:web.
   Open http://localhost:5173/dashboard/. Vite proxies /api to 127.0.0.1:3000.
5. Sign in with your existing email/password. A page refresh requires login again;
   no token is stored in localStorage, sessionStorage, URL parameters or cookies.
6. Overview → View incidents, or the Incidents navigation item. Filter by service
   and status. Open an incident; start an investigation if your role permits it.
   Retrying the same submission keeps its key; New investigation key is deliberate.
7. Timeline replays saved history and follows updates. Pause stops this browser's
   connection only. Evidence/report views label saved collection windows, missing
   data, partial results and model status. Refresh saved results does not enqueue.
8. Sandbox review still requires fresh sandbox-local.py and the separate executor
   watcher for real execution. Read the full binding and expiry, check the review
   box and confirm explicitly as ADMIN. Never expose a Docker socket to the UI.

Browser regression checks (developer use): npm run verify:p9 builds both apps and
creates/removes its own local test DB with generated temporary accounts. It uses
installed Edge on Windows. If unavailable, install Playwright's Chromium using
`npx playwright install chromium`, set `$env:SENTINEL_WEB_BROWSER_CHANNEL='chromium'`
and rerun. On non-Windows it defaults to Playwright Chromium. Tests never need your
password. Traces/videos are off; screenshots/logs are in ignored .artifacts only.
The test-only background harness collects real engine evidence without a production
BullMQ worker; the cumulative API verifier separately tests the real queue.

Public hosting is still pending. Package apps/web/dist with the API deployment,
keep frontend/backend same origin over HTTPS, support /dashboard deep links and SSE,
and perform the existing hosted bootstrap/DB/worker/collector setup. No frontend
configuration needs a database password or JWT signing secret. Cloud provisioning
can still wait until the separately approved deployment phase.

## P10.1 — Local checks and GitHub Actions

1. Open PowerShell at `V:\sentinel\sentinel`. After pulling dependency changes,
   run `npm ci` using Node 24.11.1. Keep the existing Python requirements installed
   in `.venv`; no new database, cloud account or repository secret is required.
2. Run `.venv\Scripts\python.exe scripts/check.py fast`. Expect CHECK/PASS lines
   and an ignored `.artifacts/ci-fast.json` summary. Database tests are excluded
   explicitly here; this result alone does not verify the running backend.
3. Start the existing local API/evidence/knowledge/observability stack and ensure
   the training sandbox images exist. Run
   `.venv\Scripts\python.exe scripts/check.py integration`. This includes an
   actual simulated-payment rollback in the separate training sandbox. Do not
   run `scripts/ci-bootstrap.py` locally; it is guarded for fresh Linux CI only.
4. Open the repository on GitHub → Actions → Sentinel checks → latest commit.
   Review both Fast checks jobs and Integration and browser. Open a failed step
   for its error; download summary artifacts if present. Never upload your .env
   files or credentials to diagnose a failure. Public hosting is still pending.
5. Optional, after a successful run: Settings → Rules → Rulesets → New branch
   ruleset → target main → Require status checks to pass → select both fast
   matrix checks and Integration and browser → save if your GitHub plan permits.
   Requiring pull requests changes your current direct-push workflow; decide that
   separately. These repository rules are not changed automatically by P10.1.

No manual cloud provisioning is needed for P10.1. GitHub Actions was confirmed
enabled; account allowance or organization policy can still prevent runner use.

## P10.2 — Reproduce the local fault-quality experiment

No new manual cloud setup, account or secret is required. Keep Docker Desktop
running with Linux containers. Existing .env.api must point to the dedicated local
sentinel_api database, and .env.evidence must contain the local SELECT-only deployment
reader prepared in P5. Do not paste these values into chat or commit them.

1. Open PowerShell at V:\sentinel\sentinel. Run `npm ci` after pulling and ensure
   the existing Python requirements are installed in .venv.
2. Ensure the existing API database and demo deployment database are available.
   Follow the earlier api-local/init-local setup if they are not ready. The main
   dashboard, engine and observability helper may remain running; this runner uses
   distinct ports and collectors. No executor watcher is needed.
3. Run `npm run build` and
   `.venv\Scripts\python.exe -m pytest scripts/tests/test_quality.py -q`.
4. Run `.venv\Scripts\python.exe scripts/verify-p10-quality.py`. Default: nine
   trials, roughly 12–15 minutes including startup, collection and recovery. Output
   reports each completed trial and ends with a summary. Avoid simultaneous load
   experiments. An interrupted/failed run is not a nine-trial measurement.
5. Read .artifacts/p10-quality.json and the named run's ignored results.json.
   MEASURED means completed, not perfect quality. Check misses, duplicates, healthy
   false positives, source coverage, saved reports, recovery and cleanup flags.
   Read docs/P10-EVALUATION.md for the accepted measured sample.
6. For a shorter diagnostic use `--repetitions 1` (three trials). Record its sample
   size separately. `scripts/evaluate-p6.py` is synthetic evidence evaluation, not
   another live nine-trial result. Do not merge those accuracy percentages.

The runner generates and drops only its exact sentinel_p10_quality_* database and
stops only its owned children/collector project. It does not stop shared collectors
or rewrite .env files. Raw ignored logs/results are not uploaded by CI. Cleanup
failure is reported; never use prune or delete persistent volumes to fix it.
Public hosting is unchanged; continue the separate hosted guide when ready.

## P10.3 — Checkout resilience settings

No new manual cloud setup, database migration, credential or account required.
Existing processes do not hot-reload compiled changes.

1. At V:\sentinel\sentinel, run `npm run build --workspace=@sentinel/checkout-service`.
2. Run `npm run test --workspace=@sentinel/checkout-service` (expected: 25 passed).
3. For ordinary direct checkout startup in a separate terminal, ensure its port 3001
   is free and the payment process is available. Do not start a second checkout on
   a port already owned by observability-local.py. In that case keep the helper
   running or stop its own terminal normally before a deliberate direct-start demo.
4. Optional direct-start settings, set before `npm run start:checkout`:

```powershell
$env:PAYMENT_TOTAL_TIMEOUT_MS='4500'
$env:PAYMENT_MAX_INFLIGHT='16'
$env:PAYMENT_CIRCUIT_ENABLED='true'
$env:PAYMENT_CIRCUIT_FAILURE_THRESHOLD='5'
$env:PAYMENT_CIRCUIT_COOLDOWN_MS='10000'
npm run start:checkout
```

Defaults already match these values; .env.example is documentation, not automatically
loaded by this command. Leave the existing local PAYMENT_URL, storage and timeout
setup as documented previously. Hosted/container process settings must be set in
that deployment's environment; Compose does not automatically forward arbitrary
host environment variables into a service. Tune/rebuild/redeploy only in separately
approved deployment work.

5. Observe structured errors: 503 PAYMENT_BUSY at capacity; 503 PAYMENT_CIRCUIT_OPEN
   during cooldown; 504 PAYMENT_BUDGET_EXHAUSTED at the total deadline. Health still
   returns 200. Never assume a timeout proves the payment did not execute; reuse its
   idempotency key. Use focused tests to simulate faults without affecting the demo.
6. Observability/P1/P10.2/P8 controlled training profiles disable only the breaker to
   observe sustained raw faults and rollback recovery. Ordinary direct/base Compose
   startup enables it by default. Do not copy training overrides into hosted config.
7. Existing sandbox checkout images contain their previous compiled code until rebuilt
   in reviewed demo work. CI rebuilds its own images; this task does not restart or
   overwrite your running sandbox images. No Docker volume cleanup is needed.

See P10-LEARNING-GUIDE.md for ranges, state transitions, async cancellation, exact
file walkthrough, tests, debugging, limitations and the learner exercise.

Short live verification (new ports, memory-only simulated payments, no Docker/DB
mutation): `.venv\Scripts\python.exe scripts/verify-p10-resilience.py`. Expected
PASSED, real failure/open/recovery flags true, a measured sub-1.5-second budget
response and owned_processes_stopped true. Existing payment/checkout ports may stay
occupied; this probe uses separate ports. It is also part of CI integration.
