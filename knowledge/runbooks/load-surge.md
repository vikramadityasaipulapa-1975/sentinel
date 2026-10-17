# Investigating load-related checkout degradation

## Scope

Runbook for checkout-service and payment-service. Capacity guidance requires human review before any change.

## Symptoms

Request rate increases while latency rises. Error rate may rise as downstream time budgets expire. A doubled rate is a heuristic signal, not a universal capacity threshold.

## Possible causes

Traffic growth, bursty clients, constrained concurrency or a slow dependency amplifying queueing. Increased traffic can also be a consequence of retries rather than the initiating fault.

## Checks

Compare request-rate means and pointwise latency estimates over adjacent windows with sufficient coverage. Check the baseline is nonzero before interpreting a relative change. Separate normal traffic from retry amplification. Inspect downstream latency and queueing rather than attributing every slowdown to load.

## Remediation guidance

An authorized operator can review capacity, concurrency and admission-control settings. Scaling or timeout changes require an explicit plan and approval. Retain request limits and payment idempotency; do not remove limits merely to make an error chart fall.

## Limitations

Low-volume data is noisy. The current baseline does not observe every CPU, memory or queue metric. Traffic correlation alone cannot prove saturation or justify a production scaling action.
