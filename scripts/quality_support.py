"""P10.2 scoring and isolated collector configuration. No secret output."""

import json
import math
import statistics


def cleanup_owned(steps):
    """Attempt every owned cleanup step, returning safe labels for any failures."""
    failed = []
    for label, action in steps:
        try:
            action()
        except Exception:
            failed.append(label)
    return failed


def summarize(trials):
    """Misses and failed reports stay in the fault denominator; healthy is separate."""
    faults = [row for row in trials if row["expected_cause"] is not None]
    healthy = [row for row in trials if row["expected_cause"] is None]
    delays = [
        row["detection_seconds"]
        for row in faults
        if row.get("detection_seconds") is not None
    ]
    if any(not math.isfinite(value) or value < 0 for value in delays):
        raise ValueError("Invalid measured delay")
    correct = sum(
        row.get("top_category") == row["expected_cause"]
        and row.get("report_saved", False)
        for row in faults
    )
    return {
        "trials": len(trials),
        "fault_trials": len(faults),
        "healthy_trials": len(healthy),
        "detected_faults": len(delays),
        "missed_faults": len(faults) - len(delays),
        "healthy_false_positive_trials": sum(
            row.get("incidents", 0) > 0 for row in healthy
        ),
        "top1_correct": correct,
        "top1_denominator": len(faults),
        "top1_accuracy": correct / len(faults) if faults else None,
        "detection_seconds": {
            "count": len(delays),
            "median": statistics.median(delays) if delays else None,
            "min": min(delays) if delays else None,
            "max": max(delays) if delays else None,
        },
        "recovery_checks_passed": sum(row.get("recovered", False) for row in faults),
    }


def write_configs(directory, ports, images, linux):
    """Pinned existing images; fresh ephemeral collectors, no shared volume mounts."""
    host = "host.docker.internal"
    am_target = f"{host}:{ports['alertmanager']}" if linux else "alertmanager:9093"
    prom = {
        "global": {"scrape_interval": "2s", "evaluation_interval": "2s"},
        "scrape_configs": [
            {
                "job_name": "sentinel-quality",
                "scrape_timeout": "1s",
                "static_configs": [{"targets": [f"{host}:{ports['checkout']}"]}],
            }
        ],
        "rule_files": ["/etc/prometheus/alerts.yaml"],
        "alerting": {"alertmanagers": [{"static_configs": [{"targets": [am_target]}]}]},
    }
    am = {
        "route": {
            "receiver": "sentinel",
            "group_by": ["alertname", "service"],
            "group_wait": "2s",
            "group_interval": "5s",
            "repeat_interval": "10s",
        },
        "receivers": [
            {
                "name": "sentinel",
                "webhook_configs": [
                    {
                        "url": f"http://{host}:{ports['api']}/api/v1/webhooks/alertmanager",
                        "send_resolved": True,
                        "max_alerts": 20,
                        "http_config": {
                            "follow_redirects": False,
                            "authorization": {
                                "type": "Bearer",
                                "credentials_file": "/run/secrets/token",
                            },
                        },
                    }
                ],
            }
        ],
    }
    for name, value in [("prometheus.json", prom), ("alertmanager.json", am)]:
        (directory / name).write_text(json.dumps(value), encoding="utf-8")

    def mount(name, target):
        return {
            "type": "bind",
            "source": str((directory / name).resolve()),
            "target": target,
            "read_only": True,
        }

    services = {
        "prometheus": {
            "image": images["prometheus"],
            "command": [
                "--config.file=/etc/prometheus/prometheus.json",
                "--storage.tsdb.path=/prometheus",
            ],
            "ports": [f"127.0.0.1:{ports['prometheus']}:9090"],
            "volumes": [
                mount("prometheus.json", "/etc/prometheus/prometheus.json"),
                mount("alerts.yaml", "/etc/prometheus/alerts.yaml"),
            ],
        },
        "alertmanager": {
            "image": images["alertmanager"],
            "command": [
                "--config.file=/etc/alertmanager/config.json",
                "--cluster.listen-address=",
            ],
            "ports": [f"127.0.0.1:{ports['alertmanager']}:9093"],
            "volumes": [
                mount("alertmanager.json", "/etc/alertmanager/config.json"),
                mount("token", "/run/secrets/token"),
            ],
        },
        "loki": {
            "image": images["loki"],
            "command": ["-config.file=/etc/loki/config.yaml"],
            "ports": [f"127.0.0.1:{ports['loki']}:3100"],
            "volumes": [mount("loki.yaml", "/etc/loki/config.yaml")],
        },
        "alloy": {
            "image": images["alloy"],
            "command": ["run", "/etc/alloy/config.alloy"],
            "volumes": [
                mount("config.alloy", "/etc/alloy/config.alloy"),
                mount("logs", "/logs"),
            ],
            "depends_on": ["loki"],
        },
    }
    for name, service in services.items():
        service.update(
            mem_limit="512m" if name in {"prometheus", "loki"} else "256m",
            cpus=1,
            security_opt=["no-new-privileges:true"],
        )
        if linux and name in {"prometheus", "alertmanager"}:
            service.pop("ports")
            service["network_mode"] = "host"
            service["extra_hosts"] = [f"{host}:127.0.0.1"]
            service["command"].append(f"--web.listen-address=127.0.0.1:{ports[name]}")
    (directory / "compose.json").write_text(
        json.dumps({"services": services}), encoding="utf-8"
    )
