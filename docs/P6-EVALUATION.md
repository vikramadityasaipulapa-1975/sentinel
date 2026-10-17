# P6 evaluation record

Measured on 2026-10-17 using `scripts/evaluate-p6.py` and the versioned
`apps/ai-engine/evaluation/scenarios.json` dataset. This is a **deterministic
baseline on synthetic normalized evidence**, not live model accuracy, a benchmark
of production incidents or proof that the inferred causes are correct.

| Metric                           | Measured value | Denominator / meaning                                       |
| -------------------------------- | -------------- | ----------------------------------------------------------- |
| Scenarios                        | 10             | 7 labelled fault causes + 3 no-cause/missing-evidence cases |
| Deployment cohort top-1          | 1/1            | One deployment regression only; too small to generalize     |
| Nondeployment cohort top-1       | 5/6            | Dependency, load and application faults                     |
| Overall top-1                    | 6/7 (85.7%)    | Correct labelled fault category ranked first                |
| Overall top-2                    | 7/7 (100%)     | Correct category among first two candidates                 |
| Candidate precision              | 7/13 (53.8%)   | Strict single-label precision over all emitted candidates   |
| False deployment attribution     | 1/6 (16.7%)    | Nondeployment faults whose first candidate was deployment   |
| No-cause abstention              | 3/3            | No hypothesis for healthy/insufficient-evidence cases       |
| Citation validity                | 18/18          | Cited values resolve to their original source and pointer   |
| Validated model-assisted reports | 0              | Model disabled in all ten cases                             |

The deliberately difficult coincident-release/dependency case ranks deployment
first and dependency second. A release and increased errors satisfy the simple
rule, but the supplied ground truth is dependency failure. This is a measured
limitation, not something to hide by removing the scenario. Every emitted result
remains a high-uncertainty hypothesis with CORRELATION_NOT_CAUSATION. Valid
citations alone do not establish causation. Extra plausible candidates lower the
strict precision score; it is not a confidence probability.

The dataset covers deployment regression, healthy deployment, dependency timeout,
gateway failure, load surge, application errors, recovery, healthy unchanged
traffic, missing telemetry and coincident change/fault. Ground-truth labels are
used only by the evaluator; they are not sent to an adapter. The model sees bounded
numeric facts, not scenario IDs, free-form logs or the expected category.

Reproduce locally, without any model or service mutation:

```powershell
Set-Location V:\sentinel\sentinel
.venv\Scripts\python.exe scripts/evaluate-p6.py
```

The ignored `.artifacts/p6-baseline-evaluation.json` includes counts, per-case
rankings, model statuses and the measured timestamp. After completing the optional
local model setup in MANUAL-SETUP.md, opt into a separate comparison:

```powershell
.venv\Scripts\python.exe scripts/evaluate-p6.py --local-model
```

That writes `.artifacts/p6-local-model-evaluation.json`. It still uses synthetic
inputs, not live injected faults. Check validated_model_report_count and each
model_status: unavailable/invalid/timed-out model requests can use an explicitly
labelled deterministic fallback, so aggregate metrics are not automatically model
accuracy. No such live-model run was performed during this phase. Real-world
quality and model/hardware latency remain to be validated after manual setup.
