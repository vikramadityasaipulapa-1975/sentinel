# P8 threat model and action boundary

Scope: the approved local, simulated, memory-only payment sandbox. This is not a
production executor. Trust the reviewed API code, database/migration identities,
local image preparation, executor code/configuration, Docker daemon and OS owner.
An attacker controlling those trusted components can bypass application policy;
this implementation does not claim an OS sandbox or protection from DB owners.

| Threat                                  | Boundary/control                                                                                                                                                                    | Verification                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry/runbook prompt injection      | AI engine has no action/approval tool, main DB credential or JWT signing key. Proposals accept exact fields only; decisions use authenticated live ADMIN.                           | Real HTTP malicious extra fields rejected; P7 untrusted-content tests retained.                                                         |
| Forged role/actor/approval in a body    | User comes from signed token plus live user lookup; exact proposal/decision schema; repository and executor recheck role.                                                           | Anonymous/viewer/operator decision denial; forged viewer approval fixture cancelled at executor.                                        |
| Replay/concurrent decisions             | Actor/request unique key, immutable binding, row/advisory locks, one-active-sandbox unique index; audit is atomic.                                                                  | Real proposal/approval races and audit-failure rollback.                                                                                |
| Duplicate/concurrent external execution | Durable EXECUTING claim/token before Docker; shared local file lock; no automatic retry; fenced final write.                                                                        | Two real executor attempts yield exactly one verified attempt; terminal replay does nothing.                                            |
| Expired/revoked authority               | DB clock expiry; live ADMIN/enabled/token-version and incident checks at claim and immediately before dispatch.                                                                     | Real executor fixtures for expired approval, demotion, disable and reset. Revocation cannot undo an already dispatched external action. |
| Stale image/container/source            | Setup baseline, immutable image IDs, exact container binding, Compose fingerprint, fixed project/service, checks before and after action/window.                                    | Real stale-container attempt fails before mutation; changed binding cancels.                                                            |
| SSRF/remote Docker                      | No caller URL/host fields; fixed loopback probes; redirects/proxy inheritance off; explicit local Docker endpoint allowlist.                                                        | Dangerous URL fields rejected; remote context fixture rejected.                                                                         |
| Command injection/path traversal        | No shell; fixed program/project/file/arguments; full UUID/image IDs; no caller file paths, scripts, image tags or env overrides.                                                    | Malicious UUID/image/command fixtures rejected.                                                                                         |
| Misleading recovery                     | Identity + readiness + exact synthetic payment responses, 3/3 samples over >=2s; incomplete/timeout is UNVERIFIED.                                                                  | Real short window success; synthetic unhealthy, short, malformed, missing and timeout cases.                                            |
| Crash after external effect             | Never requeue EXECUTING automatically. After two minutes and a free process lock, reconcile marks UNVERIFIED without Docker mutation.                                               | Real abandoned DB fixture reconciles; token identity mutation rejected.                                                                 |
| Privilege expansion/scope escape        | Separate Compose project/network/ports, memory storage, no persistent mounts or Docker socket in app containers, non-root payment, read-only roots/capabilities dropped.            | Container identity/hardening fixtures; real verifier compares all outside container IDs/images/states before/after.                     |
| Audit or credential leakage             | Parameterized SQL, immutable audit, protected proposal/decision/token fields, controlled errors, ignored local config; internal fencing/token versions omitted from HTTP responses. | Real mutation rejection, transaction rollback, safe response checks and ignore audit.                                                   |

Residual limits: finite checks do not prove sustained recovery or root cause.
Local Docker access is powerful; never give it to a public API or AI process.
There is a small authorization-to-dispatch interval: revocation after dispatch
cannot retract the action. PostgreSQL and Docker cannot commit atomically; timeout
and process termination require observation/review. A suspended process retains
the local execution lock; do not delete that lock to force another executor.
Manual Docker changes by the OS owner remain outside application concurrency.
The shared file lock protects one executor host only; distributed/multi-host
execution requires a separately reviewed fencing/agent design. Cloud deployment,
production change approval, signed provenance, host isolation and remote transport
are pending work, not guarantees provided by this phase.

Approval means a valid authenticated ADMIN decision, not cryptographic proof of
physical human presence. Protect ADMIN credentials; stolen/compromised trusted
accounts and compromised API/DB/executor hosts are outside this application's
prompt-injection boundary. Public hosting also needs tenant/rate-limit and host
isolation review. Action transactions compare the verified session version and
expiry under the live user lock to close middleware-to-decision reset races.
Executor claim, final authorization check and terminal persistence share the
project advisory-lock order with API mutations, avoiding incident/action lock
inversion while Docker itself remains outside database transactions.
