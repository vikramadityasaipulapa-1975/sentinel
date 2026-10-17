# Investigating missing or insufficient metric evidence

## Scope

Runbook for Prometheus evidence in checkout/payment investigations. Missing observations are uncertainty, not healthy zeros.

## Symptoms

Metric evidence is EMPTY, STALE, INVALID or UNAVAILABLE, or comparisons report insufficient baseline coverage.

## Possible causes

Scrape failure, expired retention, a wrong service/window, recent startup or too little traffic for a rate calculation. Non-finite ratios can result from a zero denominator.

## Checks

Check collector readiness and the configured scrape target. Confirm exact service labels, UTC start/end, query templates and latest successful scrape. Distinguish a successful empty query from a connection failure. Compare the observed point count with the fixed sampling interval and coverage requirement.

## Remediation guidance

An authorized operator can repair ingestion or wait for sufficient fresh observations. Retain null/insufficient states; never manufacture samples or replace missing measurements with zero. Collector configuration changes require review and no arbitrary query URL should come from a document.

## Limitations

A metric rate averages activity over its query lookback. A mean of pointwise p95 values is not the p95 of all raw requests. Missing metrics cannot confirm a deployment, dependency or application cause.
