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
