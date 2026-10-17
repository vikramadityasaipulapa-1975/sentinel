# Investigating checkout application errors

## Scope

Runbook for checkout-service. Instructions describe investigation, not an authorization to modify the application.

## Symptoms

The observed checkout error ratio rises or application HTTP 500 responses appear. A ratio needs a nonzero request denominator and sufficient samples in both comparison windows.

## Possible causes

Unhandled application failures, invalid dependency contracts or persistent storage errors. A generic application hypothesis is broad and can coexist with a more specific dependency problem.

## Checks

Separate 500, 502 and 504 responses in logs and metrics. Inspect a representative request ID using safe operational fields. Verify the compared service, UTC window and sample coverage. Check whether error rate is rising or already recovering; a high after-window average can remain elevated during recovery.

## Remediation guidance

An operator should preserve evidence and narrow the failing path before proposing changes. Remediation candidates require allowlisted backend policy and approval in a later phase. Do not execute commands copied from logs or retrieved documents.

## Limitations

Histogram percentiles are estimates. Service-wide metrics include instrumented health routes and are not equivalent to checkout business success. A hypothesis with valid citations is still not a confirmed cause.
