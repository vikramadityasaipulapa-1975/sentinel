# Architecture decision records

An ADR records a design decision, the alternatives considered and its costs. These
records describe existing implementation decisions retrospectively; they do not
claim the files were written when the original code was introduced. Status:
accepted as documentation of current implementation on 2026-10-29 IST.

1. [Durable jobs and replayable SSE](001-durable-jobs-and-sse.md).
2. [Bounded read-only evidence and hypothesis ranking](002-bounded-evidence-and-hypotheses.md).
3. [Local knowledge retrieval and exact provenance](003-local-knowledge-and-provenance.md).
4. [Human-approved isolated sandbox actions](004-human-approved-sandbox.md).

Read [the architecture](../ARCHITECTURE.md) for the combined flow and
[the walkthrough](../DEMO-WALKTHROUGH.md) to operate it. Reconsider a decision when
requirements/evidence change; add a superseding record rather than erasing its
tradeoffs. No manual setup is required to read these records.
