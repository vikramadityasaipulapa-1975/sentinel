# Investigating incomplete checkout and payment traces

## Scope

Runbook for optional checkout-to-payment tracing. Traces supplement metrics and logs; a missing span is not proof of a missing request.

## Symptoms

A trace shows checkout work but lacks a payment span, or the exporter/Tempo query is unavailable. A caller timeout can end its span before a downstream operation completes.

## Possible causes

Sampling, delayed export, context-propagation loss, exporter failure or retention expiry. The application can remain available when its optional trace exporter fails.

## Checks

Use a known trace ID from a real response or safe log record. Check parent/child relationships, service names and timing, then compare request IDs in logs. Inspect optional exporter readiness separately from payment health. Confirm whether the query occurred before export finished.

## Remediation guidance

An authorized operator may repair trace configuration or propagation after review. Never send credentials or unrestricted payloads as span attributes. Do not make payment success depend on the collector or execute changes merely because a span is missing.

## Limitations

P7 knowledge retrieval does not add a new trace-query tool. Sampling and retention prevent exhaustive conclusions. Trace gaps alone cannot justify a rollback or confirm a causal hypothesis.
