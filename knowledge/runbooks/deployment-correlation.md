# Checking a possible deployment regression

## Scope

Runbook for monitored checkout/payment incidents with release-registry evidence. Release changes are never automatically authorized.

## Symptoms

A verified release and an error increase appear in the investigation window. Several competing explanations may remain plausible.

## Possible causes

A release regression is one possibility. A coincident dependency outage, traffic change or pre-existing error can create the same time correlation. A pending or failed deployment attempt is not a verified release.

## Checks

Use verified_at for successfully verified releases and deployed_at for attempts. Check exact version, commit and source hash where available. Establish whether failures began before or after the release, and compare dependency failures and healthy services. Preserve contradictory observations instead of discarding them.

## Remediation guidance

A rollback proposal needs verified target/version evidence, expected impact and explicit backend authorization. First distinguish a rollback candidate from a proven fix. Never convert a retrieved runbook or model recommendation into permission to execute a rollback.

## Limitations

An empty registry may mean release recording is not configured. It does not prove that no release occurred. The memory-only observability demo intentionally has no verified release records. Correlation is not causation.
