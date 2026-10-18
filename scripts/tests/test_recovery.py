import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from remediation_verification import classify


def test_recovery_needs_identity_readiness_and_three_successes_over_a_window():
    good = {
        "image_matches": True,
        "version_matches": True,
        "ready": True,
        "successful_checkouts": 3,
        "samples": 3,
        "window_seconds": 2.1,
    }
    assert classify(good) == "VERIFIED"
    for patch in [
        {"image_matches": False},
        {"version_matches": False},
        {"ready": False},
        {"successful_checkouts": 2},
    ]:
        assert classify({**good, **patch}) == "FAILED"
    for patch in [
        {"samples": 1, "successful_checkouts": 1},
        {"window_seconds": 0.1},
        {"incomplete": True},
        {"outcome_uncertain": True},
        {"samples": True},
        {"window_seconds": float("nan")},
        {"ready": "true"},
    ]:
        assert classify({**good, **patch}) == "UNVERIFIED"
    assert classify({}) == "UNVERIFIED"
    assert classify({"command_failed_unchanged": True}) == "FAILED"
    assert (
        classify({"command_failed_unchanged": True, "outcome_uncertain": True})
        == "UNVERIFIED"
    )


def test_executor_distinguishes_failed_command_from_uncertain_timeout(
    monkeypatch, tmp_path
):
    import subprocess

    import sandbox_executor as executor
    from test_remediation import container

    monkeypatch.setattr(executor, "ROOT", tmp_path)
    (tmp_path / ".artifacts").mkdir()
    original = container()
    binding = {
        "current_image": original["Image"],
        "container_id": original["Id"],
        "target_image": "sha256:" + "c" * 64,
        "target_version": "payment-v1",
    }
    monkeypatch.setattr(
        executor,
        "load_config",
        lambda: {
            "context": "fake",
            "binding": binding,
            "checkout_image": "sha256:" + "d" * 64,
        },
    )
    monkeypatch.setattr(executor, "claim", lambda *args: {"id": "fixture"})
    monkeypatch.setattr(executor, "assert_authorized", lambda *args: None)
    monkeypatch.setattr(executor, "assert_checkout", lambda *args: None)
    monkeypatch.setattr(executor, "write_images", lambda *args: None)
    monkeypatch.setattr(executor, "finish", lambda *args: True)

    class FailedDocker:
        calls = 0

        def payment(self):
            return original

        def compose(self, *args):
            self.calls += 1
            raise subprocess.CalledProcessError(1, ["fixture"])

    failed = FailedDocker()
    monkeypatch.setattr(executor, "Docker", lambda _: failed)
    assert (
        executor.execute("unused", "11111111-1111-4111-8111-111111111111")["status"]
        == "FAILED"
    )
    assert failed.calls == 1

    class TimedOutDocker(FailedDocker):
        def compose(self, *args):
            self.calls += 1
            raise subprocess.TimeoutExpired("fixture", 35)

    timed_out = TimedOutDocker()
    monkeypatch.setattr(executor, "Docker", lambda _: timed_out)
    assert (
        executor.execute("unused", "11111111-1111-4111-8111-111111111111")["status"]
        == "UNVERIFIED"
    )
    assert timed_out.calls == 1
