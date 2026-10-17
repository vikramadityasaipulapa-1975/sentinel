# P6: investigation and orchestration

Cloud provisioning can wait. The user approved P6.1 after its explanation and
P6.2-P6.5 together after their task-by-task explanation. No external deployment,
paid resources, remediation or remote model transmission is included.

## P6.1 — Structured hypotheses and a model adapter

**Concept.** A schema is a contract for allowed fields/types. A model adapter is
the boundary between our application and one model protocol. A hypothesis is a
possible explanation, not a confirmed cause. A citation must resolve to a supplied
fact. Qualitative uncertainty is not a calibrated probability.

**Architecture/data flow.** Bounded typed facts → fixed safety prompt/schema →
optional local POST /api/chat → bounded JSON envelope → strict draft validation
and citation membership check → ModelResult. Model output contains only category,
support/contradiction IDs and uncertainty. It cannot introduce measurements,
URLs, commands or free-form factual claims. Disabled mode makes no network call.

**File plan / implementation / walkthrough.** `apps/ai-engine/hypothesis.py`
defines Fact, Hypothesis and ModelDraft. Validators reject extra fields,
duplicate/overlapping citations, inconsistent conclusions, unknown IDs and output
larger than 16 KiB. `llm_adapter.py` defines the ModelAdapter protocol,
DisabledAdapter and OllamaAdapter. Async HTTP has an eight-second total deadline,
32-KiB envelope cap, bounded output tokens, no redirects/proxies, no automatic
retry and an explicitly configured loopback endpoint/model. Safe statuses are OK,
DISABLED, INVALID, UNAVAILABLE and TIMEOUT; exception details are not exposed.
`configured_adapter(env)` rejects unknown providers instead of guessing. Existing
httpx/Pydantic dependencies suffice; no SDK or API key was installed.

**Approval checkpoint.** User's “do complete p6” approved the previously explained
P6.1 plan. Remaining P6 tasks subsequently received explicit combined approval.

**Run/test.** From `V:\sentinel\sentinel`:

```powershell
.venv\Scripts\python.exe -m pytest -c apps/ai-engine/pytest.ini apps/ai-engine/tests -q
.venv\Scripts\python.exe -m ruff check apps/ai-engine
```

25 cumulative tests passed. Positive: valid known citations and explicit
insufficiency parse. Negative: invalid JSON, unknown IDs, extra action fields,
wrong uncertainty types, oversized content, incomplete responses, HTTP 503 and
read timeouts fail safely. Adapter HTTP responses are fixtures, not live AI
quality evidence. Existing P5 tool tests passed in the same run.

**Debug.** DISABLED is expected without explicit configuration. INVALID can mean
unsupported/truncated model output. Do not weaken validation to accept it. A local
model can exceed the short deadline on CPU or cold start; select an appropriate
model/hardware later and measure latency before changing budgets.

**Understanding check.** Why validate JSON even when requesting a schema? Why
separate an unavailable model from insufficient evidence? Why prohibit model-made
measurements? Exercise: add a duplicate-citation rejection test.

**Manual setup.** None for fixture tests. For optional real local inference,
install Ollama from its official source yourself, choose/download a model suited
to your hardware, and configure the local provider/model explicitly. No model was
installed or downloaded by this task. Remote providers are not supported by this
adapter; cloud Ollama currently lacks this structured-output feature. Protocol
reference: [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
and [chat API](https://docs.ollama.com/api/chat). A provider adapter plus approved
telemetry disclosure is needed before any remote inference.

**Commit summary.** `feat(P6.1): validate cited hypotheses behind a bounded model adapter`.

## P6.2 — Sequential workflow and failure isolation

**Concept.** A workflow makes execution order and limits explicit. Partial failure
means useful evidence can survive a missing source. A tool budget bounds time and
calls; missing values must never be invented as zero.

**Architecture/data flow.** Revalidate Window → exactly three fixed tools, in
metrics/log/deployment order → deterministic calculation → finite scalar facts →
optional model adapter → validated workflow state. Each source gets one call and
2.7 seconds; the reference sequential workflow has a 17-second ceiling, including
the optional eight-second model call. There is no in-process retry loop; durable
worker attempts remain a separate backend responsibility.

**File plan / implementation / walkthrough.** `workflow.py` defines Tool and
InvestigationState. `guarded_source` checks source identity/window and maps known
transport/validation failures to explicit source states, preserving siblings.
`extract_facts` selects only observed numeric values and records exact JSON
pointers into their source snapshots. Empty deployment history is omitted, not
turned into a zero-release observation. Log counts retain their retrieved-set
scope. `finish_analysis` records stages, model status and partial completion.
`run_sequential` is an executable reference path; the parallel implementation
arrives separately in P6.3. `tests/test_workflow.py` tests order, missing-source
handling, invalid input and absence of invented deployment facts.
`scripts/verify-p6.py` runs actual read-only local queries with the model disabled.

**Approval checkpoint.** Explicit combined P6.2-P6.5 approval after explanation.

**Run/test.** The engine pytest command passed 28 cumulative tests. Positive:
ordered fixture sources produce observations with exact pointers. Negative:
connection failure preserves logs and creates no numeric metrics. Live check:

```powershell
.venv\Scripts\python.exe scripts/verify-p6.py
```

Passed against the real local collectors/reader. Its ignored report explicitly
says live telemetry, no model inference. No primary DB writes or faults occurred.

**Debug.** Inspect source statuses and stages rather than inferring healthy zeros.
A source/window mismatch is INVALID, not a reason to query a different service.
Unknown programming exceptions fail the job instead of silently being labelled a
network outage. The reference path is slower than parallel collection by design.

**Understanding check.** Which timeout bounds a whole workflow? Why keep worker
retries separate? Why preserve a JSON pointer alongside each fact? Exercise: test
a source that returns a valid payload for the wrong service/window.

**Manual setup.** Existing local P5 sources are needed for the live verifier. No
cloud setup or model configuration is required for the default disabled path.

**Commit summary.** `feat(P6.2): add a bounded sequential investigation workflow`.

## P6.3 — Parallel evidence graph

**Concept.** A graph node is a bounded unit of work. Three parallel branches reduce
collection latency; a join waits for all three before calculating. A checkpoint
saves execution state, but an in-memory checkpoint does not survive a crash.
Retries must not multiply across graph and durable queue layers.

**Architecture/data flow.** START fans out to metric/log/deployment nodes, each
writing its own typed state key. A three-node barrier leads to one calculation
node, then one analysis node and END. Source guards preserve useful sibling
results. No per-node retries; the existing worker owns the durable attempt budget.
The compiled graph has a 12-second deadline and recursion limit 6. PostgreSQL
leases/outbox and saved evidence remain the durable boundary: after a crash an
unfinished attempt recollects, rather than pretending a memory checkpoint survived.

**File plan / implementation / walkthrough.** `investigation_graph.py` defines
GraphState and `build_graph(tools, adapter)`, then `run_parallel` validates input
and invokes the compiled StateGraph. Distinct branch keys avoid concurrent-write
conflicts. The barrier edge takes the entire source list; separate edges into
calculation would risk repeated joins. `engine.py` now uses the graph while
preserving P5's four-source response contract. `tests/test_graph.py` uses an event
barrier to prove actual overlap without timing-performance assertions; it also
checks one failed source returns PARTIAL and matches sequential fact extraction.
`verify-p6.py` now runs both paths against live local sources.

LangGraph 1.2.16 and its installed dependency closure are pinned in the engine's
requirements, constrained during installation by the existing payment lock pins.
`pip check` passed; no existing payment versions were upgraded. Transitive packages
include LangSmith, but no tracing service/account is configured. The engine's
allowlisted environment excludes tracing keys, and graph calls have no callbacks.
We do not use hosted LangGraph/LangSmith services. API reference:
[LangGraph graph API](https://docs.langchain.com/oss/python/langgraph/graph-api).

**Approval checkpoint.** Covered by explicit P6.2-P6.5 approval.

**Run/test.** Thirty cumulative engine tests passed. Positive: all three fixture
branches enter before release, then join exactly once. Negative: a failed Loki
branch preserves metrics and creates a PARTIAL outcome. Both sequential and
parallel live source checks passed, with the model explicitly disabled.

**Debug.** Check which source key is missing; branches must not overwrite shared
lists without a reducer. Keep the join barrier intact. A recursion-limit error is
a graph design problem, not a reason to increase the limit indefinitely.

**Understanding check.** Why use distinct branch keys? What does the join wait for?
Why is the queue's durable retry different from a graph checkpoint? Exercise:
change the fixture failure from Loki to deployments and assert metrics remain.

**Manual setup.** Install engine dependencies locally/at deployment:

```powershell
.venv\Scripts\python.exe -m pip install -r apps/ai-engine/requirements.txt
```

No cloud account, tracing key or model is required. Restart the local supervisor
when testing updated engine code; it does not hot-reload.

**Commit summary.** `feat(P6.3): collect bounded evidence through parallel LangGraph branches`.

## P6.4 — Ranked, cited hypothesis reports

**Concept.** A plausible cause is not proof. Facts are observed numeric values;
hypotheses interpret those facts. Contradictions weaken an interpretation. Ranking
is an ordering, not a probability. Correlation with a release cannot establish
that the release caused an incident.

**Architecture/data flow.** Graph evidence → exact scalar facts → optional model
selection → backend eligibility/ranking rules → nondefinitive report → Node
validation against the original snapshots → one fenced transaction saving four
snapshots, report, terminal status/event and outbox completion. GET report is READ
protected. Each saved fact is bound to its snapshot UUID and SHA-256; reads verify
report and snapshot hashes plus cited values again. Historical P5 jobs still have
evidence but legitimately return REPORT_NOT_FOUND for a report.

**File plan / implementation / walkthrough.**

| File                                             | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/ai-engine/synthesis.py`                    | `synthesize(state)` creates only fixed titles/categories and facts already extracted. A verified release plus increased errors permits a deployment candidate; 502/504 logs permit dependency; at least doubled observed rate plus increased latency permits load; observed errors permit application. These deliberately simple heuristics are not calibrated causal inference. Candidates have high uncertainty and certainty=hypothesis. Missing evidence yields limitations or abstention. A valid model can reorder eligible candidates or abstain; it cannot add measurements, suppress backend contradictions or force an unsupported category. |
| `engine.py`                                      | Constructs the explicitly configured adapter and includes analysis beside the unchanged four evidence sources. The top AI flag matches the validated report; it is false for deterministic mode. Health does not imply model inference has occurred.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `llm_adapter.py` / `scripts/evidence_support.py` | Add an explicit local-only confirmation, reject cloud-labelled model tags, and preserve approved local model settings across restarts. No model is automatically enabled, downloaded or installed. Server-side cloud routing must also be disabled; a loopback address alone is not a guarantee against forwarding.                                                                                                                                                                                                                                                                                                                                    |
| `investigation_graph.py`                         | Explicit tracing_context(enabled=False) prevents graph tracing even when a shell has tracing configured. No hosted graph/tracing account is used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `apps/api/src/investigation-report.ts`           | Validates exact report fields, bounded ranks/categories and numerical fact values. Known fact IDs must have their fixed source/pointer, not merely any existing value. Recomputes eligibility, rejects invented measurements/citations, binds facts to snapshot IDs/hashes, persists canonical JSON/SHA-256 and verifies integrity on reads.                                                                                                                                                                                                                                                                                                           |
| `evidence.ts`                                    | Adds collectInvestigation for evidence plus report. The old collectEvidence wrapper preserves existing callers. Report validation uses a dynamic import to avoid a module cycle. The collector fetch budget becomes 14 seconds, response bytes remain capped.                                                                                                                                                                                                                                                                                                                                                                                          |
| `investigations.ts`                              | finish accepts an optional report, validates it and stores it in the same transaction as evidence/event/outbox. A report error rolls all writes back. Result metadata truthfully distinguishes hypothesis-report, deterministic-evidence and workflow-check. Report status can force PARTIAL even when collection succeeded. Evidence jobs request a 30-second lease; legacy jobs keep 15.                                                                                                                                                                                                                                                             |
| `investigation-queue.ts`                         | Receives the report and invokes atomic completion. Evidence work has 17 seconds, versus the old five-second compatibility check. The graph has 12 seconds and the model eight; bounded queue attempts remain three. BullMQ renews its lock while async work runs; PG token/expiry fencing remains authoritative.                                                                                                                                                                                                                                                                                                                                       |
| `007_investigation_reports.sql`                  | Additive immutable report table with investigation PK/FK, attempt, JSONB, exact canonical text, digest and timestamp. Existing migrations are unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `investigation-routes.ts` / auth test page       | Adds GET /api/v1/investigations/:id/report under READ permission and a Hypothesis report button. JSON renders as text, not executable HTML. No new write/remediation route exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Report/evidence/database tests                   | Validate fabricated values, mislabelled references, unsupported release attribution, extra action fields, report-write rollback, immutable records, snapshot bindings, HTTP auth/viewer access and replay after API reconstruction. Migration ledger tests include 007 and move the invalid fixture to 008.                                                                                                                                                                                                                                                                                                                                            |

**Approval checkpoint.** Included in explicit combined P6.2-P6.5 approval, including
LangGraph and the additive report migration. No external deployment was approved.

**Run/test.** Engine synthesis/schema/graph tests passed. A real PG/Redis/API run
passed 87 tests before additional HTTP replay coverage; final counts and reruns
are recorded in PROGRESS.md. It exercised the actual local Python collector and
worker, report/snapshot persistence, malformed-report rollback, insert failure,
normal mutation rejection and existing auth/alerts/SSE. Fixture model responses
are not live-model accuracy evidence. Final regression results follow below.

```powershell
.venv\Scripts\python.exe -m pytest -c apps/ai-engine/pytest.ini apps/ai-engine/tests -q
.venv\Scripts\python.exe scripts/verify-p3.py --task P3.5 --with-evidence
```

**Debug.** PARTIAL can mean source gaps, model timeout/invalid output or inability
to nominate a cause. Inspect model_status, limitations and facts. A disabled model
can still produce a clearly labelled deterministic report. An unreachable engine
fails/retries; an unavailable optional model preserves deterministic suggestions
with MODEL_UNAVAILABLE and PARTIAL. Never relax citations or turn an AI suggestion
into an authorized remediation.

**Understanding check.** Why bind a citation to snapshot ID/hash as well as a fact
name? Why must report and evidence writes commit together? Why can valid citations
still lead to a wrong hypothesis? Exercise: add a test attempting to label latency
as an error-ratio fact while pointing at a real numeric value.

**Manual setup.** No cloud setup is needed for deterministic reports. Optional
local model setup is documented in MANUAL-SETUP.md; no real model was run here.
Hosted runtime credentials will additionally need SELECT/INSERT on
sentinel_api.investigation_reports after migration 007. The engine/model must stay
private, and any future remote model requires a separate reviewed adapter and
explicit telemetry-disclosure approval.

**Commit summary.** `feat(P6.4): persist ranked hypotheses with verified evidence citations`.
