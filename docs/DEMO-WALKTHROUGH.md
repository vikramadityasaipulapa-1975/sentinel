# End-to-end Sentinel walkthrough

This is the operator and presentation script for the implemented local project.
Use [the architecture](ARCHITECTURE.md) to understand the components and
[P10.5 startup details](P10-DEMO.md) for fresh Windows/Linux installation.
All commands below use PowerShell at `V:\sentinel\sentinel` unless stated otherwise.
No secrets should be copied into chat, Git, browser URLs or screenshots.

## 1. Know which workflow you are running

| Workflow                  | What runs                                                                                      | What you can claim                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Main interactive app      | Dashboard/API, PostgreSQL/Redis worker, engine, knowledge, native demo services and collectors | Real authenticated incident/investigation/history/evidence workflow using simulated service traffic                            |
| Isolated fault experiment | Separate ports, collectors, temporary API DB and test-only investigation processor             | Measured alert-to-incident/evidence/report/recovery behavior in that fixture; not the main dashboard's DB or production BullMQ |
| Explicit sandbox action   | Separate payment/checkout containers on 4302/4301, exact saved proposal and trusted executor   | Human-approved simulated rollback and bounded recovery verification; not remediation of the main 3002 service                  |

The main launcher starts neither an action executor nor a deliberate fault. A healthy
traffic demo should not invent a fault or promise an automatically generated incident.
An incident associated with a sandbox proposal is a review/audit context; it does not
mean the main telemetry diagnosed that separate sandbox.

## 2. Terminal A — prerequisites and startup

Start Docker Desktop manually and wait for its Linux engine to be ready. Check:

```powershell
Set-Location 'V:\sentinel\sentinel'
node --version
npm --version
.venv\Scripts\python.exe --version
docker info --format '{{.OSType}}'
```

Expected: Node 24.x, npm 11.x, Python 3.11.x, Docker `linux`. If Docker is absent
from PATH, use the installed Docker executable's full path. One supported location
is `C:\Users\VIKRAM\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`;
verify it exists on your computer. The launcher also detects standard locations.

If `.venv` is missing on a fresh checkout, create it once with
`py -3.11 -m venv .venv`. Do not replace a working environment or delete configuration.
Read current readiness before starting a second copy:

```powershell
.venv\Scripts\python.exe scripts/demo.py doctor
```

Doctor returns safe JSON and exit 1 if core or knowledge is unavailable. It does not
start anything, enqueue work or verify worker consumption. On 2026-10-29 the observed
local services and Docker engine were unavailable; earlier green CI is historical.
If core services are READY, use them. If only knowledge is UNAVAILABLE, the app
can still show partial results: inspect the knowledge DB/cache and host resources
without resetting healthy services. For a new startup ensure these native/collector
ports are free: 3000, 3001, 3002, 8001, 9090, 9093, 3100, 3200, 4418.

If an earlier stack owns a port, stop that stack in its owning terminal with Ctrl+C.
For collectors from **this known checkout**, stop them without deleting volumes:

```powershell
docker compose -f infrastructure/compose.observability.yaml stop
```

Confirm project ownership first if other checkouts share Docker. Existing dedicated
API/demo/knowledge DB and Redis containers may remain when matching `.env*` files
exist. Lost config plus existing resources is refused: restore the original config
privately instead of generating a new password for an old database.

For the existing installed environment:

```powershell
.venv\Scripts\python.exe scripts/demo.py start --skip-install
```

For first installation or changed dependencies, use `start` without `--skip-install`.
This installs locked npm/Python dependencies in the existing venv, prepares the
local databases/readers, ingests reviewed knowledge, builds apps, then supervises
owned processes. Leave Terminal A open. Downloads/model startup can take time.

Expected: preflight passed; preparation/build output; dashboard URL; separate
core/knowledge report; foreground-supervision message. Startup failure or Ctrl+C
stops owned native children, retaining databases and any started collectors.

## 3. Terminal B — sign in and inspect permissions

Open [the dashboard](http://localhost:3000/dashboard/). Use your existing account;
you do not need another registration for each run. No default account exists.
If you need a new account, explicitly create it in this second terminal:

```powershell
.venv\Scripts\python.exe scripts/api-user.py create --email YOUR_EMAIL --role ADMIN
```

Replace YOUR_EMAIL and enter a 12–128 character password at hidden prompts. ADMIN
can authorize sandbox changes; choose that role only intentionally. Existing users
can be changed explicitly with the `role` subcommand in MANUAL-SETUP.md; startup
never silently promotes an account. Sign in again after a role/account change.

| Role     | Permitted workflow                                                                          |
| -------- | ------------------------------------------------------------------------------------------- |
| VIEWER   | Read services/incidents/events/evidence/reports/proposals; cannot write or decide           |
| OPERATOR | Additionally create/update incidents, start investigations and preview/propose sandbox work |
| ADMIN    | Additionally approve/reject exact sandbox proposals                                         |

The backend enforces the matrix even if the browser is modified. Tokens are held
in memory: refresh requires login again, and token expiry can end live progress.
`/auth-test` remains a diagnostic page; `/dashboard/` is the full UI.

## 4. Generate healthy simulated traffic

In Terminal B run this bounded 90-request sample while the launcher stays open:

```powershell
1..90 | ForEach-Object {
    $order = [guid]::NewGuid().ToString()
    $body = @{ order_id=$order; amount_minor=12500; currency='INR' } | ConvertTo-Json
    Invoke-RestMethod 'http://127.0.0.1:3001/checkout' -Method Post -TimeoutSec 10 `
        -ContentType 'application/json' -Headers @{ 'Idempotency-Key'=$order } -Body $body
    Start-Sleep -Seconds 1
}
```

Expected: simulated succeeded payments with UUIDs; no real charge. New order/key per
iteration creates distinct operations. To test replay, submit the **same body and
key** twice: the same simulated payment should return, without a second charge.
Same key with a conflicting payload is rejected (409). Memory-only launcher payment
state resets when its process restarts; durable payment idempotency is a separate
P2 PostgreSQL mode, not a promise of this memory demo.

This creates real metrics/logs/traces. Visit:

- [Checkout metrics](http://localhost:3001/metrics) and [payment metrics](http://localhost:3002/metrics): bounded route/status labels.
- [Prometheus](http://localhost:9090): query `up{job="sentinel-demo"}`; both targets should be 1 when scrapes work.
- [Tempo readiness](http://localhost:3200/ready): trace-store readiness, not a built-in trace explorer or evidence search.
- [Alertmanager](http://localhost:9093): grouped firing/resolved alert state.

Loki is a log API, not a prebuilt browser UI; inspect saved log evidence in the
dashboard. Healthy traffic need not create an alert. Sparse/short windows can still
produce PARTIAL comparisons; do not relabel them OK merely for presentation.

## 5. Create and investigate a clearly labelled demo incident

In the dashboard's service overview, check seeded `checkout-service` and
`payment-service`. The registry is metadata, not automatic discovery of arbitrary
public systems. Open **Incidents** and choose **Create incident** as OPERATOR/ADMIN.
Select checkout-service, title `DEMO: end-to-end walkthrough`, severity LOW, and
submit. This is a deliberate manual demo record, not evidence of a detected outage.
Use service/status filters and open the new incident.

Click **Mark investigating** if deliberately progressing its status. The backend
allows these transitions; arbitrary jumps are rejected:

`OPEN → INVESTIGATING → MITIGATING → RESOLVED → CLOSED`

INVESTIGATING can also go directly to RESOLVED; MITIGATING/RESOLVED can return to
INVESTIGATING as allowed by policy. CLOSED is terminal. Starting an investigation
is a separate workflow and should not be described as automatically resolving an incident.

Under **Collect evidence**, click **Start investigation** once. A retry of the same
submission retains its request key; **New investigation key** means a separate new
collection. Accepted/QUEUED means stored/queued work, not a finished diagnosis.

## 6. Follow live progress and read saved results

**Incident timeline** replays persisted events and follows investigation progress.
Look for QUEUED, RUNNING and the actual final state. PARTIAL is a legitimate result
when sources or retrieval are incomplete; failed work must not be called complete.
Use **Pause updates**, then **Reconnect**: pausing this browser leaves backend work
and saved history intact. Reconnect resumes from the saved stream position. It can
exhaust its retry budget or need login again; saved history remains available.

Use **Refresh investigations** if needed, select the saved run, then
**Saved evidence & report → Refresh saved results**. These refresh saved data and
do not enqueue another investigation. Inspect:

1. Metrics: window, coverage, source status and values; before/after comparisons
   require enough samples. The chart is a saved snapshot, not an always-live graph.
2. Logs: bounded retrieved records and source status. Truncation is not a complete
   count of every log entry. Request IDs correlate checkout/payment activity.
3. Deployments: read-only registry data; EMPTY is expected without an in-window
   registered release. A recent deployment alone is not proof of causation.
4. Ranked hypotheses: cited facts, limitations, conclusion and model status.
   Default `ai_performed: false` is deterministic analysis, not a running chat model.
5. Knowledge guidance: reviewed document/version/section/range/hash provenance.
   OK has valid retrieved context; EMPTY means no qualifying passage; UNAVAILABLE
   is a bounded failure; DISABLED means missing runtime configuration. Retrieved
   text is untrusted guidance and cannot approve a change.

The engine's source tools collect metrics/logs/deployments. Tempo trace export is
implemented, but a trace-query investigation tool/trace viewer is not. Refreshing
an old report does not recollect today's evidence; use a deliberate new investigation.

## 7. Demonstrate automatic faults and alert ingestion — isolated experiment

To reproduce controlled failures safely, use the existing **isolated** runner while
the main stack's dedicated API/deployment databases are available:

```powershell
.venv\Scripts\python.exe scripts/verify-p10-quality.py
```

Default: nine trials, three repetitions each of healthy/payment-error/payment-timeout
with recovery. Expect roughly 12–15 minutes, varying by host/downloads. It starts its
own real native services/collectors and disposable API DB, authenticates webhooks,
saves/readbacks validated evidence/reports and records misses/duplicates/recovery.
It uses its own test-only processor: do not claim this runner itself tests BullMQ.
The separate required integration suite exercises the real queue.

Read `.artifacts/p10-quality.json` and the named run's results. `MEASURED` means
completed, not necessarily perfect quality. FAILED is not a fresh successful result.
A shorter diagnostic `--repetitions 1` has only three trials; label it separately.
These incidents do **not** appear in the main dashboard: the fixture DB is isolated
and removed on owned cleanup. Do not copy a fixture incident UUID into the main app.

The recorded accepted run detected 6/6 injected dependency faults, median 21.047 s,
with 0/3 healthy false incidents, and all metric comparisons PARTIAL. These are
historical small-sample results, not promises about your next run. See
[P10 evaluation](P10-EVALUATION.md) for protocol and all denominators.
For visible main-DB alert demonstrations, the collector/webhook path is implemented,
but do not use this runner as a main-dashboard fault switch or kill the launcher's
payment child: child loss intentionally stops the supervised stack.

## 8. Optional human-approved sandbox rollback — separate workflow

This section deliberately changes only a disposable simulated sandbox and creates
real proposal/audit records in the main local API DB. Perform it only when you
intend that demo. It does not repair checkout/payment on 3001/3002 and is not a
production remediation capability. The documentation task itself does not execute it.

### Prepare known images if missing

Leave the main stack running. Check the existing images first:

```powershell
docker image inspect sentinel-payment:payment-v1 --format '{{.Id}}'
docker image inspect sentinel-payment:payment-v3-error --format '{{.Id}}'
docker image inspect sentinel-checkout:local-p2 --format '{{.Id}}'
```

If present and recognized, reuse them; don't overwrite cached identities during an
active proposal. On a fresh environment with these tags absent and a **clean reviewed
Git working tree**, build the required images once. Check `git status --short` is
empty first; never label uncommitted code as a clean commit:

```powershell
$sourceHash = .venv\Scripts\python.exe -c "import sys; sys.path.insert(0,'scripts'); from local_support import source_identity; print(source_identity()[0])"
$commit = git rev-parse HEAD
docker build -f services/payment-service/Dockerfile --build-arg PAYMENT_VERSION=payment-v1 --build-arg "SOURCE_SHA256=$sourceHash" --build-arg "GIT_COMMIT=$commit" -t sentinel-payment:payment-v1 .
docker build -f services/payment-service/Dockerfile --build-arg PAYMENT_VERSION=payment-v3-error --build-arg "SOURCE_SHA256=$sourceHash" --build-arg "GIT_COMMIT=$commit" -t sentinel-payment:payment-v3-error .
docker build -f services/checkout-service/Dockerfile -t sentinel-checkout:local-p2 .
```

If only some tags are missing, build only those. The sandbox preparer refuses
unrecognized images. Don't bypass image/binding checks or rebuild a different
image under a previously approved identity.

### Prepare, review and decide

Confirm sandbox ports 4301/4302 are free of unrelated applications. Before starting
an executor, prepare the sandbox in Terminal B:

```powershell
.venv\Scripts\python.exe scripts/sandbox-local.py
```

Expected: good-version baseline verified, deliberate payment-v3-error observed,
exact binding registered. Existing active proposals cause refusal; inspect/reject
pending work rather than deleting rows or bypassing a live executor lock.

Create/select a clearly labelled OPEN **payment-service** demo incident. In its
**Sandbox rollback & audit** panel:

1. OPERATOR/ADMIN clicks **Preview sandbox rollback**. Dry run does not execute.
2. Inspect fixed project/container/current image/target image/version, then
   **Create pending proposal**. Keep the same key on an uncertain retry.
3. Select the exact saved proposal, read binding/expiry and audit. Only a current
   ADMIN checks **I reviewed this exact proposal...**, clicks
   **Approve reviewed proposal**, and confirms in the confirmation dialog; or
   **Reject reviewed proposal**. Approval is limited by the ten-minute proposal
   lifetime; retry does not extend it. Nothing is silently authorized by a report.
4. For this one approved action, the narrowest manual run is the exact action UUID
   displayed by the app:

```powershell
.venv\Scripts\python.exe scripts/sandbox_executor.py --action ACTION_UUID
```

Replace ACTION_UUID locally with the reviewed saved action. This is execution, not
read-only inspection. Alternatively, in a dedicated Terminal C, intentionally run
`.venv\Scripts\python.exe scripts/sandbox_executor.py --watch` to consume approved
work; a watcher can consume already-approved work, so inspect outstanding approvals
before starting it. The normal launcher never starts it for you.

5. **Refresh proposals & audit**. Expect EXECUTING then the measured final state.
   VERIFIED requires target identity/readiness plus 3/3 successful synthetic
   checkouts over at least two seconds. FAILED or UNVERIFIED must remain visible.
   Inspect actor, saved events and recorded observations; the incident stays open.
6. If an attempt's outcome is ambiguous, use the documented reconciliation operation
   only after inspection: `scripts/sandbox_executor.py --action ACTION_UUID --reconcile`.
   It does not mutate Docker; never delete a live lock or blindly repeat execution.
7. Stop a watcher with Ctrl+C. To stop only this known sandbox, retaining data:

```powershell
docker compose --project-name sentinel-remediation-sandbox --env-file .env.sandbox -f infrastructure/compose.sandbox.yaml stop
```

Manual verification of recovery does not prove the sandbox caused the original
incident. If resolving your **demo** record is appropriate, use allowed incident
status buttons deliberately; don't close a real incident based on this simulation.

## 9. Optional features and automated verification

- Durable payment storage/version switching: the older P2 Compose workflow in
  [the P2 guide](P2-LEARNING-GUIDE.md) uses these same 3001/3002 ports. Stop the native
  launcher before changing modes; don't combine it with the native demo. Registry
  changes/read-only plans and applied local version switches are separate from P8.
- Enabled-breaker demonstration, without changing your main stack:
  `.venv\Scripts\python.exe scripts/verify-p10-resilience.py`. It owns separate
  memory-only ports and tests deadline, overload, breaker opening and recovery.
  The main raw-fault training helper explicitly disables the breaker.
- Optional chat model: follow [manual setup](MANUAL-SETUP.md); no provider/model is
  silently enabled. Default deterministic reports/local embeddings work without it.
  Claim model quality only after a separately measured real inference evaluation.
- Comprehensive checks: `.venv\Scripts\python.exe scripts/check.py fast` and
  `.venv\Scripts\python.exe scripts/security_scan.py`. Required integration is
  `scripts/check.py integration` with that interpreter after its prerequisites are
  ready. Integration includes real sandbox mutations; don't run a manual executor
  concurrently. Existing read-only/main account data isn't replaced by verifier users.
- Browser checks use isolated accounts/DBs; they do not execute Docker actions.
  Full integration separately covers queue/storage/evidence/knowledge/sandbox paths.
  The CI-only bootstrap refuses developer state; do not run it locally.

## 10. Shutdown, restart and troubleshooting

Ctrl+C in Terminal A stops the launcher's owned native services. Stop Terminal C
separately if you started it. Collectors and DB/Redis volumes remain. To restart,
stop this known collector project with Compose `stop`, then run the launcher again.
Do not use volume deletion/prune or reset passwords to solve a startup conflict.

| Symptom                                               | Inspect and next step                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Port occupied / WinError 10048                        | Original owning terminal/project; stop it normally, don't launch a duplicate                         |
| Docker Linux engine unavailable                       | Start Docker Desktop, wait for `docker info`; no DB reset needed                                     |
| API 503 DATABASE_UNAVAILABLE                          | Docker DB health, retained matching `.env.api`, migrations and API log; health alone isn't readiness |
| Existing account rejected at create                   | Sign in instead; reset through hidden-password CLI only if intentionally needed                      |
| 401 / live stream stops                               | Sign in again; check token expiry/account state; no query-string tokens                              |
| 403 / missing write controls                          | Check current role; backend authorization is working                                                 |
| QUEUED doesn't advance                                | Worker log, Redis, outbox/lease state; doctor does not test worker consumption                       |
| PARTIAL / knowledge UNAVAILABLE                       | Source window/coverage, model cache, knowledge DB and CPU/memory; retain deadlines                   |
| No main dashboard fault incident from isolated runner | Expected: runner uses another temporary DB                                                           |
| Sandbox preview fails                                 | Prepared exact binding/images, OPEN payment incident, active proposals/expiry                        |
| APPROVED doesn't execute                              | No automatic executor; intentionally run exact action or inspect watcher                             |
| VERIFIED but incident OPEN                            | Expected: sandbox recovery and incident resolution are distinct decisions                            |

Native logs: `.artifacts/demo/{api,engine,worker}.log` and
`.artifacts/observability/logs/{checkout,payment}.log`. Logs/config are private;
review/redact before sharing. The native log budget is bounded; archive after
inspection rather than deleting evidence to conceal a failure.

## 11. Suggested presentation narrative and completion checklist

Show: sign-in → seeded services → healthy simulated traffic/metrics → manual demo
incident → queued investigation → saved cited evidence/report and honest partials
→ replay/pause/reconnect → separate sandbox preview/proposal → explicit ADMIN decision
→ exact executor and measured audit → human review of incident status.

Explain the isolated fault experiment separately to demonstrate automatic detection;
its incidents/results are not silently spliced into the main interactive workflow.
Stop a demo at a truthful FAILED/UNAVAILABLE outcome and explain the boundary rather
than manufacturing a green result. The whole system's automated acceptance is the
fresh-runner integration suite, not a claim that every screenshot shares one incident.

Check off: tools ready; core/knowledge measured separately; own account works; traffic
is simulated; incident/run IDs are from the correct DB; source statuses/AI flag shown;
no secret in the recording; exact action reviewed; results/audit inspected; owned
processes stopped; configuration/volumes retained. UI tests alone don't prove executor
safety. Prior CI doesn't prove your machine is running today.

## 12. What remains manual for public access

No additional manual setup is required merely to read the completed documentation.
Operating the local demo requires Docker startup and an intentional account; sandbox
and optional model setup remain explicit steps above. No public deployment exists.

For shared access: choose provider/region/budget; provision private durable
PostgreSQL/pgvector and Redis; host the API/static dashboard, worker and internal
engine; provision private telemetry and real monitored-service identities; configure
least-privilege runtime/migration accounts, server secrets, migrations/ingestion,
account bootstrap, HTTPS/domain and SSE proxy behavior; verify backups/restore and
access from another device. Follow [HOSTED-SETUP](HOSTED-SETUP.md), reviewing current
provider requirements at execution time. A cloud database alone cannot run the app
or monitor services. Production remediation remains outside the implemented sandbox.
