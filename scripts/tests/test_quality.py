"""Denominators and bounds must not turn missing measurements into success."""

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from quality_support import cleanup_owned, summarize, write_configs


def test_cleanup_continues_after_an_owned_step_fails():
    visited = []

    def fail():
        raise OSError("details must not enter reports")

    assert cleanup_owned(
        [("fixture", fail), ("remaining", lambda: visited.append(True))]
    ) == ["fixture"]
    assert visited == [True]


def test_misses_and_failed_reports_stay_in_denominator():
    rows = [
        {
            "expected_cause": "dependency",
            "detection_seconds": 10,
            "top_category": "dependency",
            "report_saved": True,
            "recovered": True,
        },
        {"expected_cause": "dependency", "detection_seconds": None},
        {
            "expected_cause": "dependency",
            "detection_seconds": 20,
            "top_category": "dependency",
            "report_saved": False,
        },
        {"expected_cause": None, "incidents": 1},
    ]
    report = summarize(rows)
    assert report["top1_accuracy"] == 1 / 3
    assert report["missed_faults"] == 1
    assert report["healthy_false_positive_trials"] == 1
    assert report["detection_seconds"]["median"] == 15


@pytest.mark.parametrize("delay", [-1, float("nan"), float("inf")])
def test_invalid_delays_rejected(delay):
    with pytest.raises(ValueError):
        summarize([{"expected_cause": "dependency", "detection_seconds": delay}])


def test_no_faults_has_no_invented_accuracy():
    assert summarize([])["top1_accuracy"] is None


def test_linux_override_is_private_and_separate(tmp_path):
    import json

    ports = {
        name: 17000 + index
        for index, name in enumerate(
            ["api", "checkout", "prometheus", "alertmanager", "loki"]
        )
    }
    write_configs(
        tmp_path,
        ports,
        {
            key: "pinned-image"
            for key in ["prometheus", "alertmanager", "loki", "alloy"]
        },
        True,
    )
    services = json.loads((tmp_path / "compose.json").read_text(encoding="utf-8"))[
        "services"
    ]
    assert services["prometheus"]["network_mode"] == "host"
    assert "ports" not in services["prometheus"]
    assert (
        services["prometheus"]["command"][-1] == "--web.listen-address=127.0.0.1:17002"
    )
    assert all(
        "sentinel-observability" not in str(service) for service in services.values()
    )
