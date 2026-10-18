# Public hosting and cloud PostgreSQL: manual steps

Prepared for P5 on 2026-10-17. These are instructions for your accounts, not a
claim that Sentinel has been deployed. No hosted database, paid resource, DNS
record or external application was created. Provider interfaces/plans can change.

## What needs hosting

For the shared application, use durable hosted PostgreSQL. A managed service saves
you from maintaining the database host yourself. PostgreSQL stores Sentinel's
users, incidents, events, investigation results and exact evidence snapshots.
Moving that database alone does not make the application public or monitor it.

| Component                                    | Responsibility                               | Public access                |
| -------------------------------------------- | -------------------------------------------- | ---------------------------- |
| Web application/API                          | Login, authorized reads/writes, SSE progress | HTTPS                        |
| PostgreSQL                                   | Durable application records and evidence     | Backend only                 |
| Redis                                        | BullMQ delivery and retry coordination       | Worker only                  |
| Background worker/dispatcher                 | Executes investigations continuously         | No inbound public endpoint   |
| Python evidence service                      | Read-only collection/calculation             | Authenticated worker only    |
| Prometheus/Loki/Tempo or managed equivalents | Metric/log/trace retention                   | Private authenticated access |
| Monitored service registry DB                | Actual release history                       | Separate restricted reader   |

Anyone can eventually reach the public sign-in page. Viewing protected operational
data still requires an account; VIEWER cannot modify incidents. OPERATOR and ADMIN
permissions remain enforced by the backend. Public hosting does not mean anonymous
administration. Existing SSE provides live progress, not automatic public access.

One concrete option is **Neon for PostgreSQL and Render for application processes**.
This is a setup example, not an account purchase decision. Check your budget,
region, retention, uptime and connection limits before creating resources. Render
has different service types for public HTTP, private HTTP and outbound workers;
the evidence service needs private HTTP, while the worker needs no inbound port.
See [Render service types](https://render.com/docs/service-types) and
[private services](https://render.com/docs/private-services).

## 1. Create the database in Neon

1. Open the [Neon Console](https://console.neon.tech), create/sign in to your own
   account, and complete any account/terms steps yourself.
2. Choose **New Project**. Name it `sentinel`, select a region near your planned
   backend, and enable PostgreSQL. Choose PostgreSQL 17 for alignment with our
   tested local major version. No Neon Auth/AI/Functions feature is needed here;
   Sentinel currently implements its own authentication.
3. Create the project. In the Console its initial branch is currently named
   `production`; record the branch you actually select. Create a separate branch
   for staging rather than running tests against production.
4. Keep the owner login for migrations only. The following steps use a database
   named `sentinel_api`; create it in the branch's database controls if the initial
   database was named `neondb`. Do not put application tables in the wrong database.

These project controls and defaults are described in
[Neon's project guide](https://neon.com/docs/manage/projects); database creation is
covered in [Manage databases](https://neon.com/docs/manage/databases).

## 2. Save the correct connection details privately

Open **Connect**, select the intended branch/database/owner, and choose a **direct**
connection for migrations. Record host, database, role and password in your password
manager. Do not paste the connection string in chat, documentation, screenshots or
Git. A pooled endpoint typically contains `-pooler`; direct and pooled endpoints
are different. Start with direct connections for Sentinel's bounded persistent
pools, then validate any pooling change separately. See
[Neon's connection guide](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md).

Sentinel rejects database URL query parameters. Store a URL shaped like this in
your backend secret manager (all values below are fake):

```dotenv
SENTINEL_DATABASE_URL=postgresql://sentinel_runtime:FAKE_PASSWORD@YOUR_DIRECT_HOST/sentinel_api
SENTINEL_DATABASE_TLS=verify-full
```

Remove provider-added query parameters only because TLS is configured separately.
Keep certificate verification on. Set `SENTINEL_DATABASE_CA` to a PEM CA bundle if
your provider requires one. Do not replace a hostname with its resolved IP.
The Python deployment reader separately enables verify-full with the pinned
certifi CA bundle for remote registry connections. See
[Neon's secure connection documentation](https://neon.com/docs/connect/connect-securely).

## 3. Migrate with the owner, then create the runtime identity

**Do this in staging first, after approving the hosted deployment work.** These
commands change your selected hosted database. They were not run against a cloud
database during P5.

In the deployment job's secret manager, temporarily configure the direct **owner**
URL as `SENTINEL_DATABASE_URL`, with `SENTINEL_DATABASE_TLS=verify-full`.
From the repository root, run:

```powershell
npm ci
npm run build --workspace=@sentinel/api
node apps/api/dist/src/migrate.js
```

Expected first run: `API migrations applied:` followed by the seven pending SQL
filenames. A replay reports no new migrations. Never hand-run copied migration SQL
without the checksum ledger, and never edit an applied migration.

Connect as owner using a trusted PostgreSQL client. In psql, a password-free command
template is below; `-W` prompts privately. Replace host/owner/database, not the TLS
settings. `sslrootcert=system` requires a modern libpq client (17+ recommended).

```powershell
psql "host=YOUR_DIRECT_HOST dbname=sentinel_api user=YOUR_OWNER sslmode=verify-full sslrootcert=system" -W
```

Create the restricted runtime role with SQL, then set its password interactively
using psql's `\password`. Do not save a real password in the SQL editor history:

```sql
CREATE ROLE sentinel_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password sentinel_runtime
GRANT CONNECT ON DATABASE sentinel_api TO sentinel_runtime;
GRANT USAGE ON SCHEMA sentinel_api TO sentinel_runtime;
GRANT SELECT ON sentinel_api.services, sentinel_api.users TO sentinel_runtime;
GRANT SELECT, INSERT, UPDATE ON sentinel_api.incidents,
  sentinel_api.investigations, sentinel_api.alert_episodes TO sentinel_runtime;
GRANT SELECT, INSERT ON sentinel_api.incident_events,
  sentinel_api.evidence_snapshots, sentinel_api.investigation_reports TO sentinel_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON sentinel_api.investigation_outbox,
  sentinel_api.login_limits TO sentinel_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sentinel_api TO sentinel_runtime;
```

The `\password` line is a psql command, not SQL for the web editor. Review inherited
PUBLIC privileges and remove PUBLIC schema CREATE on a dedicated database where
needed; the runtime role must not inherit owner/admin memberships. Re-run a grant
review after every future migration rather than granting all future objects
automatically. API and worker can initially share this runtime identity; splitting
their permissions further is a future hardening task.

Neon Console-created roles can have broader memberships than roles created with
SQL. This is why the runtime identity above is created through SQL. See
[Neon roles](https://github.com/neondatabase/website/blob/main/content/docs/manage/roles.md).

Replace the API/worker owner URL with the runtime URL after migration. Keep owner
credentials exclusively in the migration job. Verify with the runtime login:

```sql
SELECT current_database(), current_user;
SELECT name FROM sentinel_api.services;
SELECT has_schema_privilege(current_user, 'sentinel_api', 'CREATE');
SELECT has_table_privilege(current_user, 'sentinel_api.evidence_snapshots', 'UPDATE');
```

The first query must name the intended DB/runtime user; the last two must be false.
The service list can be empty before hosted service registration. Run a sandbox
end-to-end investigation to validate the complete grants before production.

## 4. Register services and bootstrap the first administrator

This remains a **deployment prerequisite requiring implementation/review**.
Current seed/user CLI guards reject remote database targets. Do not bypass them
or copy password hashes from the local database. A reviewed bootstrap job needs to
register the actual hosted services and create your first admin using the existing
password-hashing implementation, hidden input and an explicit target. Subsequent
accounts need the same deliberate role assignment. No default admin is created.

## 5. Configure Redis and application processes

Provision Redis compatible with BullMQ's persistent connections, blocking commands
and retry behavior. Require authentication, verified TLS (`rediss://`), durable
storage and a no-eviction policy for queue data. Choose a continuously running
worker service; a sleeping request function is insufficient.

On Render, after the deployment adaptation below is implemented and approved:

1. Connect this GitHub repository in your own account and select branch `main`.
2. Create the **Web Service** for the API. Build with
   `npm ci && npm run build --workspace=@sentinel/api`; start with
   `node apps/api/dist/src/server.js`; health path `/ready`.
3. Create a **Background Worker**, using the same Node build and start command
   `node apps/api/dist/src/worker-main.js`.
4. Create a **Private Service** for Python. Install
   `apps/ai-engine/requirements.txt`. The current local entry point is
   `python apps/ai-engine/engine_main.py`; it needs the hosted binding adaptation
   below before private network traffic can reach it.
5. Put secrets into the provider environment/secret settings according to this
   table. Do not upload local `.env` files. Use independent random 32-byte hex keys.

| Process          | Configuration                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API              | Runtime `SENTINEL_DATABASE_URL`, `SENTINEL_DATABASE_TLS=verify-full`, optional `SENTINEL_DATABASE_CA`, `SENTINEL_JWT_SECRET`, `SENTINEL_ALERT_WEBHOOK_SECRET` |
| Worker           | Runtime DB/TLS/CA settings, `SENTINEL_REDIS_URL`, `SENTINEL_EVIDENCE_URL`, `SENTINEL_EVIDENCE_SECRET`                                                         |
| Evidence service | Matching `SENTINEL_EVIDENCE_SECRET`, `SENTINEL_PROMETHEUS_URL`, `SENTINEL_LOKI_URL`, `SENTINEL_DEPLOYMENT_READ_URL`                                           |
| Alertmanager     | Webhook destination plus its distinct webhook credential                                                                                                      |

The Python service receives no Sentinel primary DB owner/runtime URL, Redis URL or
JWT secret. The API does not need the deployment-reader credential. The local
launcher already separates these environments. See
[Render background workers](https://render.com/docs/background-workers).

## 6. Set up actual monitored release history and collectors

The monitored application's release registry is separate from Sentinel's main DB.
If hosting our demo too, provision its database and adapt P2's deliberately local
deployment recorder/migrations through a reviewed hosted workflow. Record releases
only after actual runtime verification. The memory-only observability demo has no
release records; EMPTY is expected and should remain honest.

As the monitored registry's owner, create a separate SQL login, set its password
privately, and grant only these permissions in that registry database:

```sql
CREATE ROLE sentinel_evidence_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
-- In psql: \password sentinel_evidence_reader
GRANT CONNECT ON DATABASE YOUR_MONITORED_DATABASE TO sentinel_evidence_reader;
GRANT USAGE ON SCHEMA public TO sentinel_evidence_reader;
GRANT SELECT ON public.demo_versions, public.demo_deployments TO sentinel_evidence_reader;
ALTER ROLE sentinel_evidence_reader SET default_transaction_read_only=on;
```

Set `SENTINEL_DEPLOYMENT_READ_URL` to that reader URL without query parameters.
Verify table SELECT succeeds, while payment SELECT, DELETE and CREATE TABLE fail.
Do not reuse the Sentinel runtime or monitored application owner credential.

Choose persistent Prometheus/Loki/Tempo hosting or compatible managed telemetry
storage, configure actual service scraping/log shipping/OTLP, and select retention.
Cloud PostgreSQL does not replace these systems. P5 queries Prometheus and Loki;
Tempo remains available for trace inspection from P4. Source URLs must be fixed
operator settings on private/authenticated paths. Current tools support no managed
vendor authentication headers; add and test that adapter if your chosen provider
requires bearer/basic authentication. Never publish anonymous collector APIs to
work around this missing adapter. Configure production alert thresholds from actual
workload data rather than copying P4's short demo timings.

## 7. Remaining code/configuration work before a public deployment

These are real blockers, not manual toggles you can safely guess:

- API currently binds `127.0.0.1:SENTINEL_API_PORT`. Render requires `0.0.0.0` and
  its assigned `PORT`. A reviewed host/port configuration change is required.
  [Render's port requirements](https://render.com/docs/web-services#port-binding).
- Python binds loopback port 8001. Configure private ingress, an internal bind
  address/port and health checking. The worker currently permits HTTP only on
  loopback and HTTPS elsewhere. Render private plain-HTTP addresses therefore
  require a reviewed private-network transport policy or verified TLS proxy;
  changing the URL alone will fail safely.
- Hosted bootstrap/service registration and monitored release recording need the
  reviewed workflow described above. Existing local helpers intentionally refuse
  remote targets.
- Managed collector authentication, if selected, needs the source adapter above.
- Configure same-origin HTTPS, trusted proxy handling, SSE buffering/timeouts and
  tested reconnection. The full dashboard is a later project phase.

Render services in the same region can use private networking, but inbound private
traffic depends on service type/plan. See
[Render private networking](https://render.com/docs/private-network).
Render Postgres is an alternative database choice; its internal/external TLS
behavior differs, so verify the certificate chain rather than disabling checks.
[Render PostgreSQL connections](https://render.com/docs/postgresql-creating-connecting).

## 8. Backups and public acceptance checks

Configure a restore/history window appropriate for your data and budget. Practice
restoring into a staging branch/database; a backup setting without a restore test
does not prove recovery. Check connection limits: the API and worker each have a
bounded PostgreSQL pool; replicas multiply the total. Confirm compute wake-up
latency fits our short connection deadlines, or choose always-available capacity.

After deployment is separately approved and completed, test from a second device:

1. HTTPS login works and anonymous protected requests return 401.
2. VIEWER reads but gets 403 for incident creation; OPERATOR can enqueue.
3. SSE replays then follows progress, reconnects, and respects token expiry.
4. An investigation returns four hash-verified snapshots; unavailable sources yield
   PARTIAL, and a rejected/unreachable engine fails after bounded retries.
5. Restart API/worker and confirm saved evidence stays unchanged.
6. Send a sandbox alert; confirm deduplication and no automatic incident resolution.
7. Confirm database, Redis, collector and engine administration are not public.
8. Verify backup restoration and billing alerts.

For now, your manual action is to choose the provider/region/budget and prepare
your own accounts if desired. You can provision staging PostgreSQL using steps
1–3 when ready; doing so does not complete the application deployment. Share only
non-secret choices and completion status. Keep credentials in your secret manager.

## P6 additions

Migration 007 adds immutable `sentinel_api.investigation_reports`; after upgrading
with the migration identity, grant the runtime identity SELECT and INSERT on that
table. No UPDATE/DELETE is required. The grants example above includes it.
Deterministic reports need no model account. An optional Ollama process needs
private compute, a locally installed suitable model and cloud routing disabled;
its URL remains loopback under the current adapter. Hosted multi-process model
networking or any remote provider needs separately reviewed transport/authorization.
Manual cloud/model setup can wait during local P6 development. Graph tracing is
explicitly disabled; no LangSmith account is required.

## P7 additions: private knowledge storage and model artifacts

The public app needs hosted durable storage and continuously running backend
processes; a developer's local DB cannot serve everyone. Knowledge can use a
separate PostgreSQL database on a provider supporting pgvector, while the main
incident DB keeps its current schema. Metrics/logs/traces still need collectors
and storage of their own. P7 does not provision any cloud resource.

When hosting is separately approved:

1. Confirm the chosen provider supports PostgreSQL vector(384), the vector
   extension and your region/cost needs. Create a **separate staging knowledge
   database** through its console; copy its owner URL directly into your secret
   manager. Do not reuse the incident DB owner. Provider-specific provisioning
   screens and extension policies must be checked when selecting the provider.
2. Connect privately with the migration identity and verified TLS. Apply
   `database/knowledge-migrations/001_knowledge.sql` using a reviewed migration
   runner/transaction and checksum ledger. Enable vector with the provider's
   permitted migration identity; local `knowledge-local.py` intentionally rejects
   remote URLs and must not be pointed at production.
3. Create a separate LOGIN reader using a generated password in the secret
   manager, with NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS. Grant CONNECT on
   the selected database, USAGE on `sentinel_knowledge` and SELECT on its documents
   and chunks only. Set default_transaction_read_only=on; test writes are denied.
   Never grant INSERT/UPDATE/DELETE to the engine reader.
4. Package the reviewed `knowledge/` corpus/profile in API and worker builds.
   Package the pinned ONNX/tokenizer artifacts in the engine build at
   `.artifacts/knowledge-model` relative to the repo layout, verifying each profile
   hash. Download artifacts during a controlled build, not an investigation.
   Check the model's MIT licence and preserve its attribution with redistribution.
5. Run owner ingestion as an explicit one-shot migration job. Set only that
   job's owner secret; call `knowledge_ingest.ingest(owner_url, LocalEmbedder())`
   from the engine module directory. The local helper is not a cloud deployer.
   Confirm twelve documents/72 chunks and replay zero. Remove owner credentials
   from runtime. For source updates publish a new version and matching API corpus.
6. Set `SENTINEL_KNOWLEDGE_READ_URL` only on the private engine. The URL must have
   no query-string TLS overrides; remote connections use verified TLS. Allow
   private ingress only. Keep the five-second retrieval limit in mind when
   sizing CPU and database cold-start behaviour; test it on the chosen host.
7. Apply main API migration 008 with the existing migration identity. Grant its
   runtime identity SELECT, INSERT on `sentinel_api.investigation_knowledge`.
   Restart compatible API/worker/engine processes and enqueue a staging test.
8. Verify correct citations, unknown/forged citation rejection, reader write
   denial, explicit unavailable status, authentication and preserved reports after
   restarts. Restore a backup of both DBs and confirm report text remains intact.
   Only after separately authorized public deployment test from another device.

These are pending hosting responsibilities, not completed setup. Current API and
engine remain loopback-bound; host binding/private networking, domain/TLS/SSE,
process packaging and provider-specific secret/bootstrap work still need review.
Manual cloud work can wait during subsequent approved local development phases.

## P8 additions: approvals do not authorize public production execution

Local sandbox support is complete; a production action adapter is not implemented.
The current executor rejects remote Docker engines, fixes project/service/image
scope and requires disposable memory storage. Do not loosen these checks or point
it at real payment infrastructure to make a deployment work.

When public hosting is separately approved:

1. Use a migration identity to apply 009 and 010. Grant API runtime SELECT/INSERT
   on remediation_actions, SELECT on sandbox_binding, SELECT/INSERT on
   remediation_events and usage on its identity sequence. Grant UPDATE only on
   required decision/expiry columns (status, decided_by, approver_token_version,
   decided_at); never grant DELETE or binding/identity changes. Existing incident
   event INSERT/sequence privileges remain necessary. Keep DB owners out of API
   runtime. Review the complete migration/runtime grant set in staging.
2. Keep the executor disabled for the initial public read/investigation app.
   No hosted account can operate this developer's loopback Docker sandbox. If a
   hosted training sandbox is later desired, provision it deliberately on an
   isolated trusted host with no production credentials, data, mounts or network.
   Provider/region/cost and any deployment require separate approval.
3. Separate OS/host identities: public API, investigation worker and AI engine
   must have no Docker daemon/socket permissions. A narrow private executor may
   access only its approved training host. The current native Windows development
   setup shares one OS account and does not provide that OS security isolation.
   Do not mount Docker sockets in public app/AI containers. Docker access can
   control the host; application allowlists alone are insufficient host isolation.
4. Give the private executor its own DB identity and only the columns/tables needed
   for claim/result/audit and read-only live users/incidents/services. It must not
   change proposal bindings, decisions, users or roles. Setup/registry publishing
   needs a separate trusted identity; executor may invalidate only its matching
   registry binding. Exact remote identity/credential loading and private transport
   need an environment-specific adapter: the current CLI intentionally accepts
   only the local developer configuration.
5. Provision/assign ADMIN through an authenticated, auditable administrator
   bootstrap; never ship default admin credentials or grant anonymous approval.
   Verify VIEWER/OPERATOR/ADMIN boundaries, current-user revocation, expiry,
   immutable bindings and audit completeness from a second device over HTTPS.
6. Before any real operational remediation, separately design target provenance,
   OS/network isolation, action-specific safety policy, human approval semantics,
   backups/recovery and per-environment probes. A multi-host executor needs a
   reviewed distributed fencing design; the current shared file lock is local.
   PostgreSQL/Docker cannot commit atomically; do not replace uncertainty handling
   with blind retries. Test all of this in staging before enabling any action.

No cloud changes, hosted privileged executor, paid service, real payment or
production rollback were performed. Public app provisioning and the existing
P5-P7 hosted responsibilities remain pending; manual cloud setup can wait.
