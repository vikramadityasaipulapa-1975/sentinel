# Sentinel manual setup checklist

This checklist distinguishes actions completed by the local helpers from actions
that require your account access or a separately approved hosted deployment.
Never paste passwords, tokens or connection strings into chat or Git.

## Current local environment (verified at the start of P5 planning)

The API/database/Redis and Prometheus/Loki/Tempo/Alertmanager are already running.
API readiness, Prometheus readiness and Loki readiness returned200 during P5
planning. Do not start duplicate services on occupied ports. P5 implementation is
awaiting its combined learning-first approval; the deployment reader identity and
internal evidence service are not provisioned yet.

For a later restart, open PowerShell and use the existing repository:

```powershell
Set-Location V:\sentinel\sentinel
npm ci
.venv\Scripts\python.exe -m pip install -r services/payment-service/requirements.txt
npm run build
.venv\Scripts\python.exe scripts/api-local.py
```

Keep that API terminal running. In a second terminal:

```powershell
Set-Location V:\sentinel\sentinel
.venv\Scripts\python.exe scripts/observability-local.py
```

Start Docker Desktop with Linux containers first. The API helper preserves the
existing database/account, applies only pending migrations and uses ignored local
secrets. The observability supervisor uses simulated memory-only payments; it does
not create deployment records or imply a verified release. Ctrl+C stops only owned
processes; named collector/database volumes remain. Never use down -v to debug.

Verification:

```powershell
(Invoke-WebRequest http://localhost:3000/ready).StatusCode
(Invoke-WebRequest http://localhost:9090/-/ready).StatusCode
(Invoke-WebRequest http://localhost:3100/ready).StatusCode
```

Expected200. Open http://localhost:3000/auth-test and sign in with your existing
account; there are no default credentials. Reload forgets the browser token.

P5's setup/verifier commands will be added here after they are implemented and
actually tested. A missing deployment history must remain EMPTY or UNAVAILABLE;
we will not populate invented release evidence merely to make the UI look complete.
No LLM API key, LLM account or model purchase is required for P5.

## Hosted setup (not performed; provider choice and deployment approval required)

These are ordered manual responsibilities, not a claim that public hosting exists.
Exact provider-console button names depend on the provider you choose.

1. Choose providers/region/budget for a persistent API process, background worker,
   internal Python evidence service, PostgreSQL, authenticated Redis and metrics/log/
   trace storage. Confirm private networking, long-lived workers and SSE support.
   Free sleeping web functions are not equivalent to a continuously running worker.
2. Provision durable PostgreSQL with backups. Create separate migration and runtime
   identities; do not use the provider owner as an application credential. Keep the
   demo payment/deployment registry separate from Sentinel's users/incidents/evidence.
3. Provision authenticated TLS Redis on a private network. Supply SENTINEL_REDIS_URL
   using rediss:// to the worker/dispatcher through the secret manager.
4. Configure the API's secret manager with SENTINEL_DATABASE_URL,
   SENTINEL_DATABASE_TLS=verify-full and the provider CA when required through
   SENTINEL_DATABASE_CA. Keep SENTINEL_JWT_SECRET shared across API replicas and
   SENTINEL_ALERT_WEBHOOK_SECRET distinct. Generate values locally or in the provider's
   secret manager; never use .env.example placeholders as deployed credentials.
5. Run the API migration command with the migration identity in an approved deployment
   job: node apps/api/dist/src/migrate.js. Verify its successful result before starting
   new application code. Back up first and review new schema changes. Demo seed/user
   helpers currently restrict remote databases; do not bypass those guards. Hosted
   service registration and first-admin bootstrap need a reviewed deployment workflow.
6. Configure private Prometheus and Loki read endpoints/credentials and a separate
   SELECT-only deployment-registry identity for the evidence service. P5 will document
   final variable names and SQL grants after implementation. The identity must have
   no payment-table read permission, no write privileges and no database-owner role.
7. Deploy the API, separate worker and internal evidence service. Restrict the evidence
   service to authenticated worker requests; do not expose collector administration,
   arbitrary PromQL/LogQL or database connections through the public application.
8. Configure service scraping, scoped log collection and tracing. Choose storage
   retention/sampling and traffic/error thresholds based on your actual workload.
   The short P4 demonstration thresholds are not validated production SLOs.
9. Put the public application behind HTTPS. Disable proxy buffering for SSE, allow
   streaming timeouts/reconnects, restrict forwarded headers to trusted ingress and
   enforce connection/request budgets. Browser/API should share an origin unless a
   separately reviewed CORS policy is configured.
10. Verify from a second device: sign-in, protected API reads, live progress/reconnect,
    worker execution, source failures, exact evidence history and a sandbox alert.
    Check backups and recovery. Confirm collector/database ports remain private.

Public deployment, paid resources, DNS/account changes and provider provisioning
have not been authorized by a request to complete a coding phase. Choose providers
and approve deployment separately. A provider choice is needed before precise
provider-specific UI steps can be supplied; this does not block local P5 work.
