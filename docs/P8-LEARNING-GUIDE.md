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
