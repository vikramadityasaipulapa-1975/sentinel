# ADR 001 — PostgreSQL workflow state, BullMQ delivery and SSE replay

Status: accepted description of existing implementation, documented 2026-10-29 IST.

## Context

An investigation outlives an HTTP request. Browser disconnects and worker/Redis
restarts must not turn an accepted investigation into invisible work. Progress
needs saved order, not only transient notifications.

## Decision

Persist investigation/outbox state transactionally in PostgreSQL. Dispatch through
Redis/BullMQ with bounded delivery/attempt handling, durable claims and leases.
Save incident progress events in PostgreSQL and replay them through authenticated,
bounded SSE using saved positions. Keep graph execution separate from durable job
state. Default browser tokens remain in memory and require renewed login on refresh.

## Alternatives and tradeoffs

- Run all collection inside the submission HTTP request: simpler but tightly couples
  client connection lifetime to work and complicates restart/replay semantics.
- Treat Redis or an in-memory event bus as the only record: convenient delivery,
  but requires separate recovery/durability assumptions and can lose visible history.
- Poll every resource or add bidirectional WebSockets: polling is simple but adds
  repeated reads; WebSockets add connection/protocol complexity for one-way progress.
  SSE fits this application's server-to-browser event stream, with explicit bounds.

This choice adds an outbox dispatcher, retry/lease/idempotency logic and two storage
services. Delivery may repeat; it is not a universal exactly-once guarantee. SSE
limits are per API process; hosted ingress needs its own global admission controls.

## Failure behavior and validation

Accepted/QUEUED is not completion. Interrupted work must follow durable state,
not blind duplication. Browser reconnect replays saved events and rejects malformed
cursors/query-token authentication. Token expiry/account changes stop authorization.
Queue/outage/replay cases are covered by the real PostgreSQL/Redis integration and
HTTP tests, with exact measured runs in [PROGRESS](../PROGRESS.md).

Source: `apps/api/src/investigations.ts`, `investigation-queue.ts`,
`incident-stream.ts`, `worker-main.ts` and the application migrations.

Revisit for multi-region delivery, global connection budgets or new retention needs.
