# Sentinel manual setup checklist

P5.1-P5.5 are implemented locally. For provider-specific cloud database steps,
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
.venv\Scripts\python.exe scripts/init-local.py
npm run build
.venv\Scripts\python.exe scripts/api-local.py
```

`init-local.py` preserves an existing `.env`. The API launcher starts only the demo
**database**, not another payment/checkout process. It applies the unchanged P2
migrations, prepares the reader, applies API migration 006 and starts owned API,
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
6. To rerun, generate a new key after the first run finishes. Earlier investigation
   UUIDs retain their original snapshots. **Next evidence page** follows a scoped
   cursor if more records exist. Investigations currently compare the previous
   five minutes with the latest five minutes at worker execution time; they do
   not claim to reconstruct an old incident outside collector retention.
7. Negative permission check: a VIEWER can inspect saved evidence but cannot
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
