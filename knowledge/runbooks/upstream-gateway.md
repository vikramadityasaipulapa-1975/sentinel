# Investigating upstream payment gateway errors

## Scope

Runbook for checkout-service and payment-service. Diagnostic guidance only; no automatic action is permitted.

## Symptoms

Checkout returns HTTP 502 and records an upstream failure. The payment process may be unreachable, return an invalid response, or return a controlled failure.

## Possible causes

A refused connection, dependency failure, contract mismatch or malformed downstream response. HTTP 502 does not by itself identify a deployment regression.

## Checks

Inspect payment health/readiness separately. Match checkout and payment request IDs where present. Distinguish connection failure from a valid downstream response that violates the expected contract. Check for conflicting order identifiers and oversized payload rejection without exposing response bodies or credentials.

## Remediation guidance

An authorized operator can restore a stopped dependency or investigate a contract change. Retry policy must remain bounded and reuse the idempotency key. A proposed release rollback requires independent evidence and approval; a runbook is not sufficient authority.

## Limitations

Aggregated error counters cannot distinguish every upstream failure mode. Missing payment logs may reflect ingestion problems. Do not infer a healthy dependency from an empty search.
