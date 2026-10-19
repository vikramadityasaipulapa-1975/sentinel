"""Runner failures must not be mistaken for passed checks."""
import importlib.util
from pathlib import Path
import subprocess
import pytest

spec = importlib.util.spec_from_file_location("ci_checks", Path(__file__).resolve().parents[1] / "check.py")
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)


def test_failed_command_does_not_append_a_pass(monkeypatch):
    def fail(*args, **kwargs):
        raise subprocess.CalledProcessError(23, args[0])
    monkeypatch.setattr(checks.subprocess, "run", fail)
    results = []
    with pytest.raises(subprocess.CalledProcessError):
        checks.run("fixture failure", ["unused"], results)
    assert results == []


def test_success_records_only_safe_summary(monkeypatch):
    monkeypatch.setattr(checks.subprocess, "run", lambda *args, **kwargs: None)
    results = []
    checks.run("fixture success", ["unused"], results)
    assert results[0]["status"] == "PASSED"
    assert set(results[0]) == {"check", "status", "seconds"}


@pytest.mark.parametrize("github,existing", [("false", False), ("true", True)])
def test_ci_bootstrap_refuses_developer_state(monkeypatch, tmp_path, github, existing):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1]))
    spec = importlib.util.spec_from_file_location("ci_bootstrap", Path(__file__).resolve().parents[1] / "ci-bootstrap.py")
    bootstrap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bootstrap)
    monkeypatch.setattr(bootstrap, "ROOT", tmp_path)
    monkeypatch.setattr(bootstrap.sys, "platform", "linux")
    monkeypatch.setenv("GITHUB_ACTIONS", github)
    if existing:
        (tmp_path / ".env").write_text("preserve developer configuration", encoding="utf-8")
    def forbidden():
        raise AssertionError("Docker must not be reached before the ownership guards")
    monkeypatch.setattr(bootstrap, "docker_executable", forbidden)
    with pytest.raises(RuntimeError, match="runner|overwrite"):
        bootstrap.main()
    if existing:
        assert (tmp_path / ".env").read_text(encoding="utf-8") == "preserve developer configuration"
