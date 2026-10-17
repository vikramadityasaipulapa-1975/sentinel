# P5: deterministic evidence tools

P5.1–P5.5 were approved together after the detailed learning-first explanation.
These tools gather facts; they do not call an LLM or change monitored services.
Implementation and measured results are recorded per task below. Hosted resources
are not provisioned by this phase.

## P5.1 — Typed Prometheus queries

**Concept.** Prometheus stores numeric samples over time. PromQL selects and
calculates series. Fixed templates prevent callers from submitting arbitrary
queries or network destinations. Request rate is requests/second; error ratio is
5xx/all responses; p95 is an estimated histogram percentile in seconds. These
currently include all instrumented routes, including health checks, so they are
service-level indicators rather than checkout-only business measurements.

**Architecture/data flow.** A validated service and timezone-aware window select
three templates → concurrent GET requests to the configured collector → bounded
JSON parsing → finite numeric points and a provenance locator. Maximum window:
30 minutes, step: 15 seconds, maximum: 121 points per aggregated series. HTTP
requests have two-second timeouts; the group has a 2.5-second deadline. Each
response is capped at 256 KiB, redirects are disabled, remote endpoints require
HTTPS with certificate verification. Endpoints are operator configuration, never
telemetry or user input. Empty/error/stale/partial data stays explicitly labelled.

**File plan and implementation.** `apps/ai-engine/evidence/models.py` defines
Pydantic input/output types. `Window.bounded()` rejects unknown services, missing
timezones, oversized/reversed/future windows. `result()` adds collection time.
`http.py` validates endpoints and streams capped JSON. `prometheus.py` builds
fixed templates; `query_prometheus(client, base, window)` asynchronously returns
an `Evidence`, including safe errors instead of exception details or credentials.
`tests/test_prometheus.py` uses controlled HTTP fixtures; `scripts/verify-p5.py`
separately queries real local collectors. Existing payment dependencies supply
Pydantic/httpx/pytest; no new framework or AI subscription is required.

**Approval checkpoint.** Approved by the user's request to work on all P5 after
the detailed plan. No additional approval is needed for the remaining P5 tasks.

**Walkthrough/security.** Inputs and source payloads are separate boundaries.
The client is injected for reuse/testing. `asyncio.gather` runs independent
queries concurrently; `wait_for` bounds total work. Numeric conversion rejects
invalid data and omits NaN/Infinity with a PARTIAL status. Missing is never zero.
Locators preserve the URL, exact templates, start/end and step. Source strings
remain untrusted evidence. No tool has a write method.

**Run/test.** From `V:\sentinel\sentinel`:

```powershell
.venv\Scripts\python.exe -m pytest -c apps/ai-engine/pytest.ini apps/ai-engine/tests -q
.venv\Scripts\python.exe scripts/verify-p5.py
.venv\Scripts\python.exe -m ruff check apps/ai-engine scripts/verify-p5.py
```

The first four fixture tests passed. The live verifier requires the existing
observability stack and checks nonempty request-rate samples plus an unreachable
source returning UNAVAILABLE. Actual live results are recorded in PROGRESS.md.

**Debug.** Check `http://localhost:9090/-/ready`, then the fixed queries in
Prometheus. An empty error series can mean no 5xx traffic. NaN can mean a zero
denominator; neither proves the service is healthy. Historic windows outside
retention legitimately return EMPTY. Never turn off TLS to fix a remote source.

**Understanding check.** Why is missing different from zero? Why do we fix the
query templates? What does a percentile estimate tell you that an average does
not? Independent exercise: add a test for an out-of-window source timestamp.

**Manual setup.** No new account is required locally. Start the P4 collectors
using the existing guide. Hosted source URLs and access protection are covered
in MANUAL-SETUP.md; a local collector is not shared hosting.

**Commit summary.** `feat(P5.1): add bounded typed Prometheus evidence queries`.

## P5.2 — Bounded Loki searches

**Concept.** Loki indexes labels and searches log records. A label selector fixes
which service is searched; request IDs are values, not indexed labels. Logs are
untrusted text, never instructions. Counts in this tool describe the retrieved
set, not the entire matching population.

**Architecture/data flow.** Validated Window → fixed service selector → GET
query_range, newest first, limit 100 → JSON log allowlist → counts grouped by
HTTP status plus at most five representative records. Reaching the limit marks
PARTIAL/truncated because additional records may exist. Missing logs are EMPTY,
not evidence that no errors occurred. Malformed records make the source INVALID.

**File plan/implementation/walkthrough.** `evidence/loki.py` adds
`search_loki(client, base, window)`, an async function returning Evidence. It
reuses the endpoint/response limits from P5.1, validates service/timestamps, sorts
newest-first, and retains only bounded operational fields. The existing log key
`status` is normalized to `status_code`. Free-form bodies, messages and passwords
are not returned. `tests/test_loki.py` checks grouping, sample limits, truncation,
malformed/empty responses and instruction-like discarded log content.
`scripts/verify-p5.py` now generates a real health request and checks live Loki.

**Approval checkpoint.** Covered by explicit approval for all P5 tasks.

**Run/test.** Use the P5.1 commands. Six cumulative fixture tests passed, and the
live verifier retrieved real local logs and metrics; both unavailable-source
checks passed. The health request generates real demo telemetry, not a synthetic
collector response. No application records were deleted.

**Debug.** Check `http://localhost:3100/ready`, Alloy ingestion and the service
label in P4's guide. No logs can mean the time window is wrong, ingestion is late,
or retention expired. Never present a capped count as the total error count.

**Understanding check.** Why can 100 returned records mean more exist? Why retain
request IDs as fields? Why discard arbitrary log messages? Exercise: add a test
that rejects a returned record with another service label.

**Manual setup.** No additional local setup beyond P4. Hosted log ingestion,
private authenticated collector access and retention still need provisioning.

**Commit summary.** `feat(P5.2): add bounded Loki evidence search and samples`.

## P5.3 — Deployment history and database permissions

**Concept.** A deployment attempt is not a verified release. `deployed_at` records
an attempt; `verified_at` records successful runtime verification. SQL parameters
keep the service and dates separate from executable SQL. A read-only database
role enforces permissions even if application code has a bug.

**Architecture/data flow.** A fixed service/window queries the monitored demo's
existing P2 registry through a separate SELECT-only login. SQL joins immutable
version metadata to release attempts, using verified time when available and
attempt time otherwise. Results include version, timestamps, status, backend,
commit/hash; configuration JSON and payment data are excluded. Queries fetch 51
rows to detect truncation and return at most 50. Missing checkout releases are
honestly EMPTY because only payment deployment history currently exists.

**File plan/implementation/walkthrough.** `evidence/deployments.py` validates the
reader DSN, sets verified TLS for remote hosts, read-only transactions, UTC,
connection/statement deadlines and a 2.5-second total deadline. The async reader
returns normalized Evidence with a credential-free table/filter locator.
`scripts/evidence_support.py` is a local-only owner-run setup helper: it creates
`sentinel_evidence_reader`, grants only the two table reads, and stores a generated
password in ignored `.env.evidence`. It preserves an existing stored password.
The default read-only transaction setting is defense in depth, not a substitute
for GRANT permissions. Existing P2 migrations are unchanged.

**Approval checkpoint.** Included in the all-P5 approval, including creating the
local reader identity. No hosted identities or resources were created.

**Run/test.** Start only the demo DB (does not replace running payment services):

```powershell
docker compose --env-file .env -f infrastructure/compose.yaml up -d --wait db
.venv\Scripts\python.exe scripts/evidence_support.py
.venv\Scripts\python.exe scripts/verify-p5-deployments.py
```

Existing P2 migrations must first exist; the final P5 launcher automates that
order. The standalone helper does not migrate. Ten cumulative fixture tests
passed. The real PostgreSQL verifier created its own temporary DB/reader,
inserted a clearly synthetic release, read its exact timestamp/version, checked
EMPTY for another service, then proved DELETE, payment-table SELECT and CREATE
TABLE are denied **even after disabling the default read-only setting**. It
removed only its own temporary resources. The retained local demo DB contains no
invented releases.

**Debug.** UNAVAILABLE may mean the DB is stopped or grants are missing. Never
replace the reader URL with the owner URL as a fix. On Windows Psycopg async needs
a selector loop; the verifier and engine entry point select it explicitly. The
reader does not print exception connection details or persist credentials.

**Understanding check.** Why distinguish attempted and verified times? Why test
permissions after disabling the read-only default? Why is checkout history empty?
Exercise: add a synthetic FAILED attempt to the isolated verifier and check its
verified-release count stays unchanged.

**Manual setup.** Local reader provisioning is now automated. Hosted registry
provisioning requires a separate reader and a reviewed release-recording workflow;
P2's deployment/migration CLI deliberately supports only local demo URLs. See the
final manual guide before configuring remote systems.

**Commit summary.** `feat(P5.3): read deployment history with a restricted database role`.

## P5.4 — Deterministic comparisons

**Concept.** A baseline is a reference interval. Absolute delta is after minus
before; relative percentage is delta divided by before times 100. A zero
baseline makes that percentage undefined. Missing observations are not zero and
correlation does not establish a cause.

**Architecture/data flow.** Prometheus and Loki Evidence with identical service
and time window → equal adjacent halves → per-metric sample means → absolute and
relative changes plus coverage. At least three points and 50% expected coverage
in each half are required. An insufficient series has null calculations and an
explicit INSUFFICIENT_DATA status. NaN, duplicate/out-of-window timestamps and
mismatched evidence windows are rejected.

**File plan/implementation/walkthrough.** `evidence/calculations.py` exposes pure
`compare_metrics(metrics, logs) -> Evidence`; no HTTP, SQL, clock-dependent query
or AI decision happens inside the arithmetic. Coverage expects the fixed
15-second sampling step. A point at the midpoint belongs only to the after half.
Each metric reports both means, delta, relative percent, coverage and an explicit
ZERO_BASELINE reason. p95 calculations compare means of pointwise histogram
percentile estimates; they are not a recomputed percentile of raw requests.
Absent logs yield null, and capped log counts remain labelled retrieved-only.
`tests/test_calculations.py` contains known-value, sparse, non-finite, zero and
UTC-offset cases. UTC offsets representing the same instants compare equally.

**Approval checkpoint.** Covered by the combined all-P5 approval.

**Run/test.** The existing engine pytest command passed fourteen cumulative
tests; Ruff passed. Positive case: 2 → 4 gives delta 2 and 100%. Negative cases:
missing/sparse data stays insufficient, NaN and mismatched windows are rejected;
0 → 4 gives delta 4 with an undefined relative percentage. These are deterministic
fixtures, not claims about the current service error rate.

**Debug.** Inspect coverage before interpreting a delta. A recent startup lacks a
full baseline. Stale data is insufficient even if historical numbers exist. Check
units: request rate is per second, ratio is fractional and latency is seconds.

**Understanding check.** Why is 0 → 4 not a 400% increase? Why can an apparently
large change remain insufficient? Why do matching UTC instants matter more than
matching display offsets? Exercise: add a negative-delta fixture (4 → 2).

**Manual setup.** No manual setup required; this task is pure calculation.

**Commit summary.** `feat(P5.4): calculate bounded before and after evidence changes`.
