# P10.2 — Local fault-quality evaluation

## Scope and protocol

Client date: 2026-10-20 IST. The live run uses real local checkout/payment processes,
Prometheus, Loki/Alloy, Alertmanager, webhook authentication, PostgreSQL incidents,
parallel evidence tools and backend-validated saved reports. Payments are simulated.
Investigation processing is a private test-only harness, not BullMQ. Knowledge
retrieval and optional chat models are disabled. No remediation runs.

Three repetitions each of healthy traffic, payment errors (checkout HTTP 502) and
payment timeouts (checkout HTTP 504): nine trials, six labelled dependency faults.
Each repetition uses a 35-second healthy control and two 40-second fault windows;
each fault has 45 seconds of healthy recovery. One request at a time, target 0.5-second
interval, eight-second request transport deadline. Achieved throughput is measured.
This is bounded functional load, not a capacity/saturation benchmark.

Collectors, ports, log directory, webhook credentials and API database are separate
from development services. The existing deployment registry is accessed through its
local SELECT-only role; no synthetic release is inserted to make attribution easier.
Pinned collector images and the existing CheckoutHighErrorRate rule are reused:
30-second ratio window, >25% 5xx, >0.05 requests/second, six-second hold, two-second
scrape/evaluation and two-second Alertmanager grouping delay.

Detection delay uses a monotonic clock from fault-mode readiness/traffic start to
first observed new persisted incident. Startup time is excluded. Polling happens
after each request, so delay includes request/pacing/query overhead; it is an observed
upper bound, not the exact internal webhook latency. Misses have no invented delay.
Top-1 compares the first saved hypothesis category with the injected dependency
cause. Missing detections and failed reports remain in the six-fault denominator.
Healthy false incidents are reported separately. Recovery means all requests return
201 and the alert signal is resolved while the incident remains OPEN.

## Live measured results

Completed run: sentinel_p10_quality_24d3a37eb651. Status MEASURED; all nine
expected HTTP cohorts verified independently after execution. Raw results are in
ignored .artifacts/p10-quality.json and the named run's results.json.

- Faults detected: 6/6; missed faults: 0/6.
- Healthy controls with an incident: 0/3. Each fault created exactly one incident.
- Saved top-1 category correct: 6/6 (100% for these dependency-only faults).
- Detection delay: median 21.047 seconds; min 15.032, max 24.656; n=6 detected faults.
- Recovery: 6/6; signal resolved, incident remained OPEN, recovery requests all 201.
- 569 trial requests; achieved healthy/error throughput about 2 req/s, timeout
  throughput 0.973–0.978 req/s. These are observed rates, not a capacity ceiling.
- Saved reports were read through authenticated HTTP; hashes/categories independently
  verified afterward. No model inference occurred.

| Repetition | Scenario        | Requests | Achieved req/s | Incidents | Detection seconds | Saved top category | Recovery       |
| ---------- | --------------- | -------: | -------------: | --------: | ----------------: | ------------------ | -------------- |
| 1          | healthy         |       70 |          1.999 |         0 |                 — | —                  | not applicable |
| 1          | payment-error   |       80 |          1.994 |         1 |            15.032 | dependency         | passed         |
| 1          | payment-timeout |       39 |          0.973 |         1 |            24.656 | dependency         | passed         |
| 2          | healthy         |       70 |          1.999 |         0 |                 — | —                  | not applicable |
| 2          | payment-error   |       80 |          1.994 |         1 |            17.563 | dependency         | passed         |
| 2          | payment-timeout |       40 |          0.978 |         1 |            24.609 | dependency         | passed         |
| 3          | healthy         |       70 |          1.996 |         0 |                 — | —                  | not applicable |
| 3          | payment-error   |       80 |          1.994 |         1 |            18.547 | dependency         | passed         |
| 3          | payment-timeout |       40 |          0.978 |         1 |            23.547 | dependency         | passed         |

All nine metric comparisons were PARTIAL because of short windows. Deployment
source was EMPTY in all nine windows; no release was fabricated. Individual source
status counts are recorded below. These limits do not disappear when top-1 matches.

- prometheus: 1 PARTIAL, 8 OK.
- loki: 6 OK, 3 PARTIAL.
- deployments: 9 EMPTY.
- calculations: 9 PARTIAL.

Cleanup independently checked: no containers for the owned project, disposable
database absent from pg_database, generated webhook-token file absent. Existing
development collectors/database were not targeted by cleanup. Backend report
validation and source/hash verification remained active.

Seven Python scoring/config/cleanup tests and one Node fixture-ownership test
passed, including missing-report/missed-detection denominators, nonfinite/negative
time rejection and refusing main DB/mismatched artifact directories before connecting.

## Separate synthetic baseline

Reran scripts/evaluate-p6.py against the unchanged ten hand-authored fixtures:

- Seven labelled causes: top-1 correct 6/7 (85.714%); top-2 correct 7/7.
- Candidate precision: 7/13 (53.846%); 18/18 citation references valid.
- One false deployment attribution among six nondeployment causes (16.667%).
- No-cause abstention: 100% in this fixture set.
- Model DISABLED for all ten cases; no network inference requested.

These results are not pooled with live trials. Small hand-authored fixtures cannot
establish production or chat-model accuracy. A plausible citation can still support
an incorrect causal attribution, as this baseline demonstrates.

## Limits and interpretation

- Timeouts here produce HTTP 504 errors and trigger the high-error rule. Slow
  requests that still return 200 are not covered by this detection experiment.
- Both live fault types share the dependency label. This does not test broad
  deployment/load/application discrimination. The synthetic set covers more labels
  but has different evidence and denominators.
- Three repetitions per scenario provide a small repeatability check, not calibrated
  confidence, production SLOs or a reliable tail-latency percentile.
- A 40-second query window and 15-second engine query step cannot supply the required
  three samples per comparison half. Metric comparisons remain partial; do not invent
  before/after deltas. Actual dependency rankings can be driven by observed 502/504 logs.
- Loki retrieves at most 100 records. Truncation/partial status and retrieved-only
  counts must remain visible. Deployment EMPTY is expected with no in-window release.
- Healthy 5xx ratios may contain nonfinite empty-denominator values, rejected as partial.
- Existing collectors/demos may run on the same Windows machine. Results describe
  that local environment, not a dedicated production benchmark.
- A correct top category is still a hypothesis; no automatic action is authorized.
- Public hosting, paid model evaluation, capacity testing and learner exercises are open.

## Reproduce and debug

See P10-LEARNING-GUIDE.md P10.2 for file/function/async/security walkthrough and
MANUAL-SETUP.md P10.2 for prerequisites and exact commands. Run npm run build,
then .venv\Scripts\python.exe scripts/verify-p10-quality.py. --repetitions 1 is
only a three-trial diagnostic; keep its result separate. Never reset shared volumes
or route the experiment's Alertmanager to the main API to work around a failure.
