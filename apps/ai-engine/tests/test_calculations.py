from datetime import timedelta, timezone

import pytest
from evidence.calculations import compare_metrics
from evidence.models import result
from test_prometheus import window


def inputs(before, after):
    win = window()
    start = win.start.timestamp()
    points = [[start + i * 15, before if i < 10 else after] for i in range(20)]
    metrics = result(
        "prometheus",
        win,
        {},
        series={key: points for key in ("request_rate", "error_ratio", "p95_seconds")},
    )
    return metrics, result("loki", win, {}, "EMPTY")


def test_known_arithmetic_and_absent_logs():
    value = compare_metrics(*inputs(2, 4))
    row = value.data["comparisons"]["request_rate"]
    assert row["absolute_delta"] == 2 and row["relative_percent"] == 100
    assert value.data["logs_observed"] is None


def test_zero_baseline_is_undefined_not_infinity():
    row = compare_metrics(*inputs(0, 4)).data["comparisons"]["request_rate"]
    assert row["relative_percent"] is None and row["absolute_delta"] == 4
    assert row["relative_reason"] == "ZERO_BASELINE"


def test_sparse_and_invalid_points():
    metrics, logs = inputs(1, 2)
    metrics.data["series"]["request_rate"] = []
    assert compare_metrics(metrics, logs).status == "PARTIAL"
    metrics.data["series"]["error_ratio"][0][1] = float("nan")
    with pytest.raises(ValueError):
        compare_metrics(metrics, logs)


def test_timezone_equivalence_and_mismatched_windows():
    metrics, logs = inputs(2, 4)
    offset = timezone(timedelta(hours=5, minutes=30))
    logs.window = logs.window.model_copy(
        update={
            "start": logs.window.start.astimezone(offset),
            "end": logs.window.end.astimezone(offset),
        }
    )
    assert compare_metrics(metrics, logs).status == "OK"
    logs.window = logs.window.model_copy(update={"service": "payment-service"})
    with pytest.raises(ValueError):
        compare_metrics(metrics, logs)
