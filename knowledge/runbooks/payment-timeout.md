# Investigating payment dependency timeouts

## Scope

Runbook for checkout-service and payment-service. Guidance, not evidence that a current incident has this cause. No action here grants execution permission.

## Symptoms

Checkout returns HTTP 504 while waiting for a payment response. Dependency spans may end before the payment span. A slow payment can still finish after checkout gives up.

## Possible causes

Payment latency, connection contention or a checkout deadline shorter than the downstream work. An absent trace is not proof of an absent request.

## Checks

Compare checkout duration with the configured payment timeout. Correlate a request ID across both services and inspect payment completion time. Compare latency and error-rate windows with sufficient coverage. Establish whether a verified release occurred before degradation; timing alone does not establish causation.

## Remediation guidance

An operator may investigate resource pressure or a known latency profile. Any timeout change requires review of the end-to-end budget and idempotent retries. Do not immediately retry with a new payment key: an earlier payment might already have committed. Changes require separate backend authorization.

## Limitations

Sampled traces and capped log searches are incomplete. A timeout identifies the caller's deadline, not the underlying bottleneck. This runbook cannot authorize remediation or confirm a root cause.
