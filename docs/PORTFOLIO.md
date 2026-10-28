# Evidence-backed portfolio wording

Use these as technical descriptions of the implemented project, not claims about
employment, production customers, paid traffic or business impact. Measurements are
historical local samples; do not relabel them as production SLOs or general AI accuracy.

## Suggested résumé bullets

- Built an authenticated React/Express incident workspace with PostgreSQL-backed
  records, role-based permissions, durable investigation delivery using an outbox
  and BullMQ, and replayable SSE progress.
- Implemented bounded parallel metric/log/deployment evidence collection and ranked,
  backend-validated hypothesis reports with immutable source citations; integrated
  reviewed local embeddings/pgvector guidance using a separate read-only identity.
- Designed human-approved simulated rollback with exact expiring image/container
  bindings, a separate allowlisted sandbox executor and saved recovery/audit results.
- Measured six of six detected dependency faults across nine controlled local trials,
  with median detection delay 21.047 seconds and zero incident-producing healthy
  controls out of three; documented partial evidence, test-harness scope and limits.
- Added Windows/Linux checks, full-history secret scanning and fresh Linux
  integration/browser validation of database, queue, evidence, knowledge and sandbox
  behavior, with a supervised local demo that retains configuration and volumes.

Choose two or three bullets for space; explain the design in your own words. Do not
claim you completed learner exercises, operated a public service or trained a model
unless you actually did those things. Default reports use deterministic heuristics;
local embeddings are not chat-model reasoning.

## Claim-to-evidence map

| Claim                       | Evidence and qualifications                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Durable workflow and replay | [ADR 001](adr/001-durable-jobs-and-sse.md), API/Redis integration and SSE tests; not universal exactly-once delivery                  |
| Parallel cited analysis     | [ADR 002](adr/002-bounded-evidence-and-hypotheses.md), graph/citation tests; hypotheses can still be wrong                            |
| Local knowledge provenance  | [ADR 003](adr/003-local-knowledge-and-provenance.md), real embedding/reader and forged citation tests; small corpus, bounded failures |
| Human-controlled action     | [ADR 004](adr/004-human-approved-sandbox.md), real sandbox tests and threat model; no production executor                             |
| Detection timing            | [P10 evaluation](P10-EVALUATION.md), nine trials/six dependency faults; model and knowledge disabled, test-only processor             |
| Build/test delivery         | [Progress](PROGRESS.md) and linked exact CI runs; runner evidence is distinct from current local uptime                               |

## Honest interview answers

**What does the AI do?** Default reports deterministically rank hypotheses from
validated saved evidence. A local model adapter is optional; actual model inference
and its accuracy were not established by the recorded default runs. Embeddings
retrieve reviewed guidance; they cannot authorize an action.

**What did you measure?** A small controlled local dependency-fault experiment:
6/6 detections, median 21.047 s (15.032–24.656, n=6), 0/3 healthy false incidents.
Short-window calculations were all PARTIAL. A separate synthetic evaluation had
6/7 top-1 among labelled causes and a documented false deployment attribution.
Do not pool these populations or round them into a broad accuracy claim.

**Is it publicly deployed?** No. The repository has a local application and hosted
setup instructions. Provisioning/private networking/credentials, server processes,
HTTPS/SSE and recovery testing remain separate work.

**Can it fix production incidents?** No. It can execute only the reviewed simulated
sandbox capability after exact human approval. VERIFIED proves its bounded recovery
checks, not causation or production safety; incident resolution remains human-controlled.

**What would you improve next?** Evaluate broader real fault classes and retrieval
relevance; benchmark cold knowledge startup; review hosted networking/identity/global
admission/retention and backup restore. Choose improvements from evidence rather
than describing unimplemented roadmap items as finished features.

## Demonstration and ownership

Use [the complete walkthrough](DEMO-WALKTHROUGH.md); show missing/partial outcomes
instead of editing screenshots. Preserve metric denominators and disclose separate
main-app, isolated experiment and sandbox contexts. Use your configured Git account
as sole commit author. No résumé file or external profile is published by this task.
