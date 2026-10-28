# ADR 004 — Exact human approval and a separate allowlisted sandbox executor

Status: accepted description of existing implementation, documented 2026-10-29 IST.

## Context

An incident suggestion is uncertain. Action execution has different privileges
from investigation. Retries, stale runtime identity and concurrent decisions must
not broaden authorization or trigger duplicate changes.

## Decision

Limit executable remediation to the separate simulated payment sandbox. OPERATOR/
ADMIN can preview/propose; only a current ADMIN decides an exact expiring proposal.
Bind project, container, current/target image and version. A separate trusted CLI
executor rechecks authority/expiry/identity, claims durable work and uses fixed
Docker operations plus bounded recovery probes. Save the decision/action audit.
The API, browser, engine and retrieved text cannot execute Docker actions directly.

## Alternatives and tradeoffs

- Automatic LLM rollback: shorter response path but grants write authority to
  uncertain/untrusted analysis and defeats human review.
- Approval of a generic command or floating version tag: flexible but cannot bind
  the exact inspected target/effect and permits dangerous drift.
- Docker socket in the API: easier deployment wiring, but broadens the exposed API
  process's authority. Separate executor placement permits a narrower trust boundary.

This needs explicit image preparation, exact bindings, state transitions, a lock,
executor operation and recovery checks. Native local processes share the OS account;
this is application separation, not a secure multi-user host sandbox. SQL audit
triggers do not defeat a privileged schema operator and are not a cryptographic chain.

## Failure behavior and validation

Refuse stale/expired/unauthorized/mismatched actions; report ambiguous outcomes rather
than blindly repeating a mutation. VERIFIED covers the specified sandbox identity
and recovery probes only. It neither establishes root cause nor resolves the incident.
Tests include concurrent decisions, stale identity, invalid authority, safe executor
rejection and real isolated Docker rollback/recovery. UI browser tests themselves
do not execute Docker actions. See [the threat model](../P8-THREAT-MODEL.md).

Source: `apps/api/src/remediation-*.ts`, application remediation migrations,
`scripts/sandbox-local.py`, `sandbox_executor.py`, `sandbox_support.py`.

Revisit only under a separately approved production threat/privilege review. Current
implementation intentionally provides no production action executor.
