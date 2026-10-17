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
