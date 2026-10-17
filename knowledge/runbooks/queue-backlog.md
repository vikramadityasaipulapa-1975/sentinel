# Investigating queued or stalled investigations

## Scope

Runbook for the Sentinel investigation worker and Redis queue. Observations here describe the control plane, not the monitored payment outcome.

## Symptoms

Investigations remain QUEUED, outbox dispatch repeats or a RUNNING attempt is recovered after its lease expires.

## Possible causes

Redis connectivity, a stopped worker, model latency, engine failure or expired database leases. Duplicate delivery is expected in an at-least-once queue and must not duplicate terminal history.

## Checks

Check API readiness, worker startup mode and engine health separately. Inspect persisted attempt count and outbox state with authorized access. Check Redis authentication/TLS and whether the worker's work budget fits its lease. Verify a recovering attempt owns the current lease token before accepting output.

## Remediation guidance

An authorized operator can restore failed dependencies or restart an owned local supervisor. Do not manually mark a job complete, delete an outbox entry or remove lease fencing to clear a queue. Production restarts or queue changes require explicit approval.

## Limitations

An engine health response does not prove collector or model availability. A model timeout can produce a partial deterministic report. Queue delay does not establish the cause of the original monitored incident.
