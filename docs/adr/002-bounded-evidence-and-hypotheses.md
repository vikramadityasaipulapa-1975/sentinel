# ADR 002 — Bounded read-only collection and evidence-grounded hypotheses

Status: accepted description of existing implementation, documented 2026-10-29 IST.

## Context

Telemetry can be missing, stale, oversized, contradictory or malicious. Waiting
indefinitely for every source would block investigations. A ranked explanation
must preserve uncertainty and must never become authorization to execute commands.

## Decision

Use fixed validated Prometheus/Loki/deployment tools with read-only source access,
bounded windows/outputs/deadlines and guarded source statuses. A LangGraph joins
parallel source branches before calculations/ranking. Persist backend-validated
snapshots/reports with exact citations. Default ranking is deterministic and says
`ai_performed: false`; a separately configured local model adapter is optional.
No arbitrary query/command tool or action authority is given to the model.

## Alternatives and tradeoffs

- Sequential reads: easier to follow and retained as a reference workflow, but
  independent I/O adds latency. Parallelism needs explicit join/failure/cancellation.
- Free-form LLM agent with arbitrary tools: more flexible but harder to bound,
  validate, reproduce or secure against telemetry instructions.
- Claim a result only if all sources succeed: hides useful partial evidence and
  encourages ignoring actual failure/coverage limitations.

Fixed tools reduce flexibility and default heuristics can rank causes incorrectly.
A schema-valid citation is provenance, not proof of causation. EMPTY/PARTIAL/
UNAVAILABLE remain visible; missing metric coverage cannot be invented. The graph
has no crash-safe checkpoint; PostgreSQL owns durable job state (ADR 001).
Tempo trace export exists separately; this decision does not imply a trace-search tool.

## Failure behavior and validation

Guarded branches preserve successful sources when another fails or times out.
Tests compare sequential/parallel facts, exercise a hanging-source cancellation and
reject report references outside exact saved evidence. The live dependency-only
experiment and synthetic baseline have separate denominators and limitations:
[P10 evaluation](../P10-EVALUATION.md). No production/chat-model accuracy is claimed.

Source: `apps/ai-engine/workflow.py`, `investigation_graph.py`, `evidence/`,
`llm_adapter.py`; `apps/api/src/evidence.ts`, `investigation-report.ts`.

Revisit only with measured tool needs, model evaluation and reviewed safety bounds.
