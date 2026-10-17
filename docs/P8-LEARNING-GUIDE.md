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
