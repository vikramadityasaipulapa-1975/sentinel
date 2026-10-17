# Investigating PostgreSQL connection or query pressure

## Scope

Runbook for storage-dependent service incidents. Sentinel's primary database and the monitored payment database have separate identities and responsibilities.

## Symptoms

Readiness fails, connection acquisition times out or bounded queries are cancelled. Health can stay alive while a database dependency is unavailable.

## Possible causes

Database downtime, exhausted connection capacity, lock contention or certificate/network problems. Increasing an application pool can worsen database saturation.

## Checks

Distinguish connect, query and lock timeouts using safe error categories. Confirm the intended database and verified TLS configuration without exposing credentials. Review bounded pool sizes across all replicas and inspect connection/lock metrics with an authorized read-only client. Preserve the difference between application readiness and process health.

## Remediation guidance

An authorized operator should resolve the identified dependency or capacity issue. Credential changes, query cancellation and pool changes require review. Never use an owner credential to bypass a restricted reader's permission error or disable certificate verification to restore connectivity.

## Limitations

Current checkout telemetry may not include database-internal metrics. Query cancellation is a deadline boundary, not proof of corruption. This document contains no executable permission grant.
