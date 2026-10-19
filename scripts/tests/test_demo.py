"""Lifecycle and preflight safety without touching developer services or databases."""

from contextlib import ExitStack
from pathlib import Path
import socket
import subprocess
import sys
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import demo_support as demo  # noqa: E402


def test_occupied_port_is_refused_without_stopping_owner():
    with socket.socket() as owner:
        owner.bind(("127.0.0.1", 0))
        port = owner.getsockname()[1]
        owner.listen()
        with pytest.raises(RuntimeError, match=f"Port {port} is occupied"):
            demo.free_ports([port])
        # The original listener still owns its port after refusal.
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            pass


def test_free_ephemeral_port_passes():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    demo.free_ports([port])


def test_hosted_config_refused_without_modification(monkeypatch, tmp_path):
    monkeypatch.setattr(demo, "ROOT", tmp_path)
    path = tmp_path / ".env"
    original = "DATABASE_URL=postgresql://user:fake@host.invalid:5432/hosted\n"
    path.write_text(original, encoding="utf-8")
    with pytest.raises(RuntimeError, match="dedicated loopback"):
        demo.validate_configs()
    assert path.read_text(encoding="utf-8") == original


def test_missing_config_with_existing_volume_refused_before_prepare(monkeypatch, tmp_path):
    monkeypatch.setattr(demo, "ROOT", tmp_path)
    monkeypatch.setattr(demo, "free_ports", lambda: None)
    monkeypatch.setattr(demo.shutil, "which", lambda name: name)
    monkeypatch.setattr(demo, "docker_executable", lambda: "docker")
    monkeypatch.setattr(demo.sys, "version_info", (3, 11))
    monkeypatch.setattr(demo.os, "environ", {})
    def capture(args):
        if args[0] == "node":
            return "v24.11.1"
        if args[0] in {"npm", "npm.cmd"}:
            return "11.6.2"
        if "info" in args:
            return "linux"
        if "volume" in args:
            return "sentinel-api_api-data"
        return ""
    monkeypatch.setattr(demo, "capture", capture)
    with pytest.raises(RuntimeError, match="restore the original file"):
        demo.preflight()
    assert list(tmp_path.iterdir()) == []


def test_partial_launch_failure_stops_previously_started_child(monkeypatch, tmp_path):
    monkeypatch.setattr(demo, "ROOT", tmp_path)
    child = Mock()
    child.poll.return_value = None
    launch = Mock(side_effect=[child, OSError("fixture launch failure")])
    monkeypatch.setattr(demo.subprocess, "Popen", launch)
    runtime = demo.DemoStack()
    with pytest.raises(OSError, match="fixture launch failure"):
        with runtime.stack:
            runtime.launch("first", ["unused"], {})
            runtime.launch("second", ["unused"], {})
    child.terminate.assert_called_once_with()
    # Both log handles close, including the one opened before failed Popen.
    for path in (tmp_path / ".artifacts/demo").glob("*.log"):
        path.unlink()


def test_owned_handle_escalates_only_after_terminate_timeout():
    child = Mock()
    child.poll.return_value = None
    child.wait.side_effect = [subprocess.TimeoutExpired("fixture", 10), 0]
    demo.stop(child)
    child.terminate.assert_called_once_with()
    child.kill.assert_called_once_with()
    assert child.wait.call_count == 2
    completed = Mock()
    completed.poll.return_value = 0
    demo.stop(completed)
    completed.terminate.assert_not_called()


def test_runtime_launch_cleanup_owns_only_exact_child(monkeypatch, tmp_path):
    monkeypatch.setattr(demo, "ROOT", tmp_path)
    child = Mock()
    child.poll.return_value = None
    unrelated = Mock()
    monkeypatch.setattr(demo.subprocess, "Popen", lambda *args, **kwargs: child)
    runtime = demo.DemoStack()
    runtime.launch("fixture", ["unused"], {})
    runtime.__exit__(None, None, None)
    child.terminate.assert_called_once_with()
    unrelated.terminate.assert_not_called()


def test_doctor_reports_knowledge_separately(monkeypatch, tmp_path):
    monkeypatch.setattr(demo, "ROOT", tmp_path)
    monkeypatch.setattr(demo, "ready", lambda *args, **kwargs: None)
    monkeypatch.setattr(demo, "values", lambda name: {"SENTINEL_KNOWLEDGE_READ_URL": "fake"})
    monkeypatch.setattr(demo.subprocess, "run", lambda *args, **kwargs: Mock(stdout="UNAVAILABLE\n"))
    report = demo.doctor()
    assert report["core"] == "READY"
    assert report["knowledge"] == "UNAVAILABLE"
    assert report["worker"] == "NOT_CHECKED_BY_HTTP"


def test_repeat_reader_preparation_preserves_existing_config(monkeypatch, tmp_path):
    import evidence_support

    monkeypatch.setattr(evidence_support, "ROOT", tmp_path)
    monkeypatch.setattr(evidence_support, "local_env", lambda: {"DATABASE_URL": "postgresql://sentinel:fake@127.0.0.1:55432/sentinel"})
    monkeypatch.setattr(evidence_support.psycopg, "connect", lambda *args, **kwargs: ExitStack())
    monkeypatch.setattr(evidence_support, "grant_reader", lambda *args: None)
    path = tmp_path / ".env.evidence"
    original = ("# Learner comment retained\n"
                "SENTINEL_DEPLOYMENT_READ_URL=postgresql://sentinel_evidence_reader:fake@127.0.0.1:55432/sentinel\n"
                "SENTINEL_EVIDENCE_SECRET=fake-placeholder\n"
                "SENTINEL_PROMETHEUS_URL=http://127.0.0.1:9090\n"
                "SENTINEL_LOKI_URL=http://127.0.0.1:3100\n"
                "LEARNER_NOTE=retain this value\n")
    path.write_text(original, encoding="utf-8")
    evidence_support.prepare_reader()
    evidence_support.prepare_reader()
    assert path.read_text(encoding="utf-8") == original


def test_linux_collectors_use_localhost_and_reset_inherited_ports(monkeypatch, tmp_path):
    import json

    (tmp_path / "infrastructure/observability").mkdir(parents=True)
    for name, content in [("prometheus.yaml", "host.docker.internal:3001 alertmanager:9093"),
                          ("alertmanager.yaml", "http://host.docker.internal:3000")]:
        (tmp_path / "infrastructure/observability" / name).write_text(content, encoding="utf-8")
    monkeypatch.setattr(demo, "ROOT", tmp_path)
    monkeypatch.setattr(demo.sys, "platform", "linux")
    monkeypatch.setattr(demo, "docker_executable", lambda: "docker")
    args = demo.collector_command()
    assert args.count("-f") == 3
    directory = tmp_path / ".artifacts/demo"
    override = json.loads((directory / "compose.json").read_text(encoding="utf-8"))
    for service, port in [("prometheus", 9090), ("alertmanager", 9093)]:
        assert override["services"][service]["network_mode"] == "host"
        assert f"--web.listen-address=127.0.0.1:{port}" in override["services"][service]["command"]
    assert "127.0.0.1:9093" in (directory / "prometheus.yaml").read_text(encoding="utf-8")
    assert (directory / "ports.yaml").read_text(encoding="utf-8").count("!reset []") == 2
