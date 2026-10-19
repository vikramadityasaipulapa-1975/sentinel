# P10.5 — Reproducible foreground demo

## Concept

A reproducible demo gives another developer a documented path from a fresh checkout
to the same local architecture. A **preflight** checks conflicts before setup changes
anything. **Preparation** installs/builds software, applies existing migrations and
seeds the two demo services. **Readiness** asks whether a service can answer now.
**Supervision** keeps exact child-process handles so partial startup and Ctrl+C can
stop the processes this launcher created.

This remains a hybrid demo: Compose runs PostgreSQL, Redis and collectors; native
Node/Python processes run the API, worker, engine and simulated checkout/payment.
This preserves reviewed loopback access rules. Putting everything into containers
would require a separate networking/configuration review. No new API or schema,
Docker socket in the API, default administrator, real payment or external deployment
is introduced. Local memory checkout/payment are simulated traffic sources; the
Sentinel API, investigations, events and knowledge use their real development DBs.

Knowledge retrieval is independent of HTTP health. The actual eight-second retrieval
subprocess can return UNAVAILABLE on a busy machine even while the dashboard works.
Doctor never extends that application deadline. A passing probe is one measured
sample, not a guarantee that every later investigation will finish successfully.

## Architecture/data flow

1. `demo.py start` checks ports, config destinations, tools and Docker Linux mode.
   Missing config plus existing matching Docker resources is refused, so a new random
   password cannot silently replace a lost configuration for an old volume.
2. Default startup installs both pinned Python requirement sets in the active venv
   and runs `npm ci`. `--skip-install` uses dependencies already provisioned by you/CI.
3. Existing init/knowledge/API helpers create only missing settings, prepare the
   dedicated databases, replay immutable migrations and seed known demo services.
   Builds produce API, checkout and dashboard bundles.
4. `DemoStack` directly owns engine, API and worker handles; the existing `Demo`
   context directly owns checkout/payment. No Python supervisor is wrapped and killed
   while its children continue running. The worker receives the evidence secret but
   not the JWT signing/webhook secrets. The engine gets the existing reader settings.
5. Collectors start using pinned Compose images. Windows Docker Desktop uses its
   existing host gateway; Linux generates ignored overrides so Prometheus and
   Alertmanager can reach loopback native services and bind their own HTTP listeners
   to loopback. Loki/Alloy/Tempo retain their existing Compose networking.
6. Core readiness is awaited, then doctor independently probes knowledge. The
   foreground checks owned native processes and a combined 20 MB native-log budget.
   A child exit or log-budget excess stops owned native children with a clear failure.
7. Ctrl+C unwinds exact owned handles, first terminate/wait, then kill/wait only if
   that same child exceeds its shutdown budget. Dependency containers and volumes
   remain. Failed partial starts also unwind; collectors already started remain for
   inspection. No broad process matching, volume deletion or production cleanup.

## File plan → Approval checkpoint

The user approved P10.5's portable launcher, safe preflight/readiness, setup reuse,
fresh-checkout CI and manual documentation before implementation. Scope excludes
hosted provisioning, paid services, production actions and automatic account creation.

## Implementation → Walkthrough

- `scripts/demo.py`: argparse accepts `start` or `doctor`. `start` returns only when
  stopped or failed. Default install requires an active venv; it never installs into
  global Python. `--skip-install` checks package availability and the npm lock marker.
  Preparation runs bounded subprocess argument arrays, never shell text. Runtime
  snapshots local config bytes and refuses an unexpected runtime change. Exceptions
  from dependency libraries print their type rather than possibly secret-bearing data.
- `scripts/demo_support.py`: `values(name)` reads trusted local files as UTF-8,
  refusing symlinks. `validate_configs()` checks dedicated database roles, ports and
  paths, API TLS-disable only for loopback, Redis destination and collector URLs.
  `free_ports(ports)` binds/releases probes; an occupied port raises without killing
  its owner. `preflight()` also rejects ambient Sentinel/payment overrides, requires
  Python 3.11, Node 24, npm 11, Git, Compose and a running Linux Docker engine.
  These are checks, not a lock: a later race can still fail startup safely.
- `prepare()` sequentially calls existing setup commands and workspace builds;
  each command has a timeout and nonzero exits stop the sequence. Existing reviewed
  knowledge is ingested idempotently; service seeds create no human users.
- `collector_command()` returns an argument list. On Linux it writes ignored config
  copies plus Compose overrides under `.artifacts/demo`; inherited published ports
  are explicitly reset before host networking. Prometheus and Alertmanager keep
  loopback listeners. No committed collector settings are overwritten.
- `DemoStack.launch(name,args,env)` opens an ignored local log, starts one direct
  Popen child and registers its shutdown callback in an ExitStack. `__enter__`
  starts dependencies in order and waits for readiness; any exception closes the
  stack. `check()` detects child exits/log limits. `__exit__` unwinds callbacks in
  reverse order; ExitStack continues other callbacks even if one fails.
- `ready(port,path,child,seconds)` polls bounded loopback HTTP and checks an optional
  owned process. `stop(child)` targets only that Popen handle. No host-wide kills.
- `doctor()` returns safe JSON: core endpoint states, a separate knowledge state,
  an explicit worker-not-checked marker and scope. Its knowledge subprocess uses
  the real existing retrieval wrapper with its unchanged eight-second cap, inside
  a bounded outer diagnostic call. No raw query output, URLs or secrets are printed.
  It doesn't enqueue an investigation, create records or verify worker consumption.
- `scripts/evidence_support.py`: existing reader grants remain bounded to the local
  DB. Configuration now appends missing defaults rather than rewriting existing
  comments/custom settings/secrets. Existing passwords are retained; preparation
  reapplies the existing reader-role password/grants to that dedicated local DB.
- `scripts/observability_support.py`: explicit UTF-8 for the webhook file; parent
  directories are created safely on first startup. Existing demo ownership is reused.
- `scripts/ci-bootstrap.py`: fresh Linux GitHub runner guards remain. CI calls the
  same `preflight()`, `prepare()` and `DemoStack`, then the required integration/browser
  suite. It asserts owned native handles exited, runtime config bytes stayed identical
  and a second preparation preserves config. CI removes only its known Compose
  containers/networks, attempts every cleanup, and never requests volume deletion.
- `scripts/tests/test_demo.py`: real socket positive/refusal tests plus explicit
  lifecycle/config/collector/readiness doubles; no developer databases touched.
- CI uploads only `.artifacts/p10-demo-verification.json`, a safe acceptance summary,
  alongside existing safe summaries. Native logs/config/model caches are ignored and
  are not uploaded. Documentation links this task's exact commands and limits.

## Run/test — exact manual steps

### Existing running checkout (your current situation)

Do not start another copy on the same ports. From `V:\sentinel\sentinel`:

```powershell
.venv\Scripts\python.exe scripts/demo.py doctor
```

Expected: per-service READY/UNAVAILABLE, separate knowledge READY/UNAVAILABLE/
NOT_CONFIGURED, worker `NOT_CHECKED_BY_HTTP`. Exit 0 means core and knowledge probes
were ready; exit 1 means some probe is unavailable. Doctor is read-only for project
state, although embedding libraries may use their existing local cache.
Open `http://localhost:3000/dashboard/` and sign in with your existing account.
Never create a duplicate account just to restart a demo.

For a launcher startup, first stop the native services in their owning terminals
with Ctrl+C. Stop the **known current checkout's** collector project, retaining data:

```powershell
& 'C:\Users\VIKRAM\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe' compose -f infrastructure/compose.observability.yaml stop
```

On another computer use `docker` from PATH. Check Docker Desktop's project labels
and original directory before stopping a project if multiple checkouts share Docker.
Do not stop unrelated containers. API/demo/knowledge DB and Redis containers may
remain: matching local config is reused. Never delete `.env*` to bypass a conflict.

Then run (dependencies already installed):

```powershell
.venv\Scripts\python.exe scripts/demo.py start --skip-install
```

Expected: preflight pass, setup/build progress, core-started dashboard URL, separate
readiness report, foreground-supervision message. Leave this terminal open. Ctrl+C
stops owned native children; collector containers/data remain. To restart, stop that
known collector project as above first. Startup intentionally refuses any occupied
collector/native port instead of silently adopting another stack.

### Fresh Windows checkout

1. Install Git, Node 24/npm 11 and Python 3.11; start Docker Desktop with Linux
   containers. First preparation needs internet for locked packages, pinned images
   and checksum-verified embedding artifacts. Allow time/resources for these downloads.
2. Use a new folder whose parent exists; do not clone over your existing repository:

```powershell
git clone https://github.com/vikramadityasaipulapa-1975/sentinel.git sentinel-demo
cd sentinel-demo
py -3.11 -m venv .venv
.venv\Scripts\python.exe scripts/demo.py start
```

3. On a shared Docker engine, the launcher refuses existing Sentinel resources whose
   matching config is absent. Use your original checkout/config instead. A fresh clone
   is intended for a fresh development environment, not a second copy of the same stack.
4. In a second terminal in this clone, explicitly create your own local ADMIN:

```powershell
.venv\Scripts\python.exe scripts/api-user.py create --email YOUR_EMAIL --role ADMIN
```

Replace YOUR_EMAIL locally. Enter the password in the hidden terminal prompts
(12–128 characters). No password/token in command arguments or chat. If an account
already exists, sign in with it; do not recreate it. No automatic default user exists. 5. Open `http://localhost:3000/dashboard/`, sign in, load services/incidents. Seeded
`checkout-service`/`payment-service` are demo metadata, not monitored public systems. 6. Run doctor in that second terminal. For full validation use the commands below.
An optional chat-model provider and P8 sandbox/executor are separate explicit
setups in MANUAL-SETUP.md; this launcher does not start an action executor, inject
faults, build the sandbox or authorize rollback. Hypotheses remain suggestions. 7. Keep ignored `.env*` and Docker volumes together. Back up sensitive config privately;
never paste it into chat or commit it. Losing a password does not justify resetting
a database. Existing users/incidents persist in API DB storage.

### Fresh Linux checkout

Use the same Git/Node/npm/Docker prerequisites and a compatible Python 3.11 install:

```bash
git clone https://github.com/vikramadityasaipulapa-1975/sentinel.git sentinel-demo
cd sentinel-demo
python3.11 -m venv .venv
.venv/bin/python scripts/demo.py start
# In a second terminal:
.venv/bin/python scripts/api-user.py create --email YOUR_EMAIL --role ADMIN
.venv/bin/python scripts/demo.py doctor
```

Stop the known checkout's collectors before a restart with
`docker compose -f infrastructure/compose.observability.yaml stop`. Linux host-network
Prometheus/Alertmanager are intentionally loopback-only. WSL without Docker Desktop
integration or other host/container arrangements require their own network review;
macOS has not been verified by this task.

### Developer checks and expected outcomes

```powershell
.venv\Scripts\python.exe -m pytest scripts/tests -q
.venv\Scripts\python.exe -m ruff check scripts apps/ai-engine services/payment-service
.venv\Scripts\python.exe scripts/check.py fast
.venv\Scripts\python.exe scripts/security_scan.py
```

Positive tests cover a free socket, exact child shutdown, repeat reader configuration
preservation and independent readiness states. Negative tests cover an occupied live
listener (owner remains alive), hosted DB URL refusal without file modification,
missing config with an existing volume, and shutdown escalation only after timeout.
Linux generated configs are checked for loopback listeners and inherited-port reset.
These unit tests explicitly use doubles for processes/DB/Compose; they do not claim
real integration coverage. CI runs the shared real lifecycle on a fresh Linux runner,
including real DB/Redis/worker/telemetry/knowledge/sandbox/browser tests. The CI-only
bootstrap refuses developer machines and must not be run locally to bypass safety.

Measured results and the final CI URL are recorded in PROGRESS.md. Do not interpret
an unrun/pending check as passed. A previously slow local knowledge run remains
recorded; a single successful doctor sample does not erase it.

## Debug

- Occupied port: the launcher names it before installation/preparation. Find the
  original terminal/project and stop it normally. No process is killed for you.
- Docker unavailable: start Docker Desktop and wait for Linux engine readiness.
  The helper checks standard Windows installation locations if docker is not on PATH.
- Missing config with existing volumes: restore the original ignored file privately.
  Do not generate a different password for the same data or delete volumes.
- Dependency failure: use Python 3.11 in `.venv`, Node 24/npm 11 and the committed
  requirements/lockfile. Inspect bounded install output; do not disable pins.
- Core unavailable: inspect local `.artifacts/demo/{api,engine,worker}.log` and
  `.artifacts/observability/logs/{checkout,payment}.log`, and Docker project status.
  Logs are private debugging data; review/redact before sharing.
- Knowledge UNAVAILABLE: check knowledge DB, pinned model cache and host resources;
  rerun doctor when load is lower. Preserve the eight-second application deadline.
  Reports may be PARTIAL; never invent retrieved citations or equate health with RAG.
- Worker: doctor does not verify job consumption. Queue a deliberate local test via
  the signed-in UI and inspect durable progress/results, or use required integration.
- Startup interruption/failure retains databases and any started collectors for
  inspection. It doesn't roll back migrations or delete accounts. Stop known
  collectors manually before retry. A forcibly killed launcher/host crash cannot
  guarantee graceful child cleanup; use normal Ctrl+C and inspect owned state.
- Log budget: inspect/archive local logs manually, then restart. Nothing automatically
  deletes logs to conceal an error. This is a demo, not production log management.

## Hosted setup and manual responsibilities

No new manual cloud setup is required for P10.5. This launcher is local only.
Public users still need a hosted backend/static dashboard, durable hosted PostgreSQL
(including pgvector where knowledge is deployed), Redis, continuously running worker
and internal evidence engine, shared telemetry stores, least-privilege credentials,
secret manager, migrations/seeding, account provisioning, HTTPS/domain, SSE-compatible
proxy and backups/retention. Use MANUAL-SETUP.md's hosted checklist in order; choose
providers/costs with the user before provisioning. Do not expose these local collector
ports, disable auth, or depend on this computer's DB for a public deployment. A cloud
DB stores state; it does not by itself monitor services or run the backend/worker.

## Understanding check

1. Why is an HTTP health response insufficient to prove knowledge or worker readiness?
2. Why does the launcher retain containers but refuse occupied ports on restart?
3. Why must an old database volume keep its matching password/configuration?

Independent exercise: add a temporary doctor probe for a deliberately unused loopback
port; confirm it reports UNAVAILABLE without changing any project data. Explain why
that result must not be labelled READY. Revert your exercise before normal use.

## Commit summary

`feat(P10.5): add a supervised reproducible local demo workflow`

Configured Git account only, no co-author trailers. P10.6 architecture/ADR/demo/resume
work requires its own explanation and approval; this task does not mark it complete.
