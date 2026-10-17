import math
from statistics import mean

from .models import Evidence, result


def compare_metrics(metrics: Evidence, logs: Evidence):
    """Compare adjacent equal halves; arithmetic is descriptive, never causal."""
    window = metrics.window
    if logs.window != window:
        raise ValueError("Evidence windows/services must match")
    start, end = window.start.timestamp(), window.end.timestamp()
    middle = (start + end) / 2
    expected = max(1, math.ceil((end - start) / 2 / 15))
    comparisons = {}
    for name in ("request_rate", "error_ratio", "p95_seconds"):
        points = metrics.data.get("series", {}).get(name, [])
        before, after = [], []
        seen = set()
        for stamp, value in points:
            if (
                not math.isfinite(stamp)
                or not math.isfinite(value)
                or not start <= stamp <= end
            ):
                raise ValueError("Invalid numeric point")
            if stamp in seen:
                raise ValueError("Duplicate sample timestamp")
            seen.add(stamp)
            (before if stamp < middle else after).append(value)
        coverage = {
            "before": min(1, len(before) / expected),
            "after": min(1, len(after) / expected),
        }
        enough = (
            metrics.status in {"OK", "PARTIAL"}
            and min(coverage.values()) >= 0.5
            and min(len(before), len(after)) >= 3
        )
        old, new = (mean(before), mean(after)) if enough else (None, None)
        delta = new - old if enough else None
        relative = delta / old * 100 if enough and old != 0 else None
        if any(
            v is not None and not math.isfinite(v) for v in (old, new, delta, relative)
        ):
            old = new = delta = relative = None
            enough = False
        comparisons[name] = {
            "status": "OK" if enough else "INSUFFICIENT_DATA",
            "before_mean": old,
            "after_mean": new,
            "absolute_delta": delta,
            "relative_percent": relative,
            "coverage": coverage,
            "relative_reason": "ZERO_BASELINE" if enough and old == 0 else None,
        }
    return result(
        "calculations",
        window,
        {
            "method": "adjacent-half-means-v1",
            "pivot_epoch": middle,
            "input_sources": ["prometheus", "loki"],
        },
        "OK" if all(v["status"] == "OK" for v in comparisons.values()) else "PARTIAL",
        comparisons=comparisons,
        logs_observed=logs.data.get("retrieved_count")
        if logs.status in {"OK", "PARTIAL"}
        else None,
        log_count_scope="retrieved_records_only",
        meaning="Descriptive sample means; no causal conclusion. p95 comparison is a mean of pointwise p95 estimates.",
    )
