# ADR 003 — Reviewed local embeddings, pgvector and immutable citations

Status: accepted description of existing implementation, documented 2026-10-29 IST.

## Context

Incident hypotheses benefit from related runbooks, but external/retrieved content
may be wrong or contain instructions. A saved report needs stable source context,
even when a document changes later. Local development should not require paid
embedding/model credentials.

## Decision

Use pinned, hash-verified local embedding artifacts and versioned reviewed documents
in a separate PostgreSQL/pgvector store. Ingestion uses its preparation identity;
runtime retrieval uses a SELECT-only reader. Retrieve a bounded number of passages,
then validate document/version/section/range/content hashes before storing context.
Use a killable retrieval subprocess with the existing eight-second application cap.
Knowledge text cannot grant authority or override backend action policy.

## Alternatives and tradeoffs

- Hosted embeddings/vector service: can simplify CPU/model operations but adds
  provider/network/privacy/cost dependencies and separate provisioning decisions.
- Keyword-only search: smaller runtime but changes retrieval relevance behavior.
- Save links only: smaller records but the linked text could change after a report.

Local CPU startup/import costs are meaningful. A healthy engine can still return
knowledge UNAVAILABLE within its deadline. Twelve reviewed documents/72 indexed
passages are a small portfolio corpus, not evidence of broad operational coverage.
Copies/versioned context add storage and ingestion/validation complexity.

## Failure behavior and validation

Missing reader configuration is DISABLED; no qualifying passage is EMPTY; bounded
retrieval failure is UNAVAILABLE. Do not substitute a fabricated citation. Tests
exercise real embeddings/pgvector, idempotent ingestion, runtime reader permissions
and forged source/range/hash rejection. A current doctor sample and historical
strict cold-start failures must be reported separately.

Source: `scripts/knowledge-local.py`, `apps/ai-engine/knowledge_*.py`,
`apps/api/src/knowledge-context.ts`, `database/knowledge-migrations/`, `knowledge/`.

Revisit for larger corpora, measured relevance, multilingual needs or hosted privacy
requirements; do not silently extend deadlines to hide slow retrieval.
