"""Synthetic boundary fixtures; real Docker rollback is verified by verify-p8.py."""

import copy
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sandbox_executor as executor
import sandbox_support as support


def container():
    return {
        "Id": "a" * 64,
        "Image": "sha256:" + "b" * 64,
        "Config": {
            "Labels": {
                "com.docker.compose.project": support.PROJECT,
                "com.docker.compose.service": "payment",
            },
            "User": "10001:10001",
            "Env": [
                "STORAGE_MODE=memory",
                "DEPLOYMENT_ID=88888888-8888-4888-8888-888888888888",
            ],
        },
        "HostConfig": {
            "SecurityOpt": ["no-new-privileges:true"],
            "Privileged": False,
            "ReadonlyRootfs": True,
            "CapDrop": ["ALL"],
            "PortBindings": {"3002/tcp": [{"HostIp": "127.0.0.1", "HostPort": "4302"}]},
        },
        "NetworkSettings": {"Networks": {support.PROJECT + "_default": {}}},
        "Mounts": [],
    }


def test_only_exact_hardened_memory_sandbox_identity_is_allowed():
    row = container()
    support.assert_container(row, row["Image"], row["Id"])
    variants = []
    for patch in [
        {"Privileged": True},
        {"ReadonlyRootfs": False},
        {"CapDrop": []},
        {"SecurityOpt": []},
        {"PortBindings": {"3002/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3002"}]}},
    ]:
        bad = copy.deepcopy(row)
        bad["HostConfig"].update(patch)
        variants.append(bad)
    bad = copy.deepcopy(row)
    bad["Config"]["Labels"]["com.docker.compose.project"] = "sentinel-demo"
    variants.append(bad)
    bad = copy.deepcopy(row)
    bad["Config"]["Env"].append("DATABASE_URL=forbidden")
    variants.append(bad)
    bad = copy.deepcopy(row)
    bad["Mounts"] = [{"Type": "bind"}]
    variants.append(bad)
    for bad in variants:
        with pytest.raises(ValueError):
            support.assert_container(bad, row["Image"], row["Id"])
    with pytest.raises(ValueError):
        support.assert_container(row, "sha256:" + "c" * 64)
    with pytest.raises(ValueError):
        support.assert_container(row, row["Image"], "d" * 64)


def test_remote_docker_context_is_rejected_before_mutation(monkeypatch):
    monkeypatch.setattr(support, "docker_executable", lambda: "fake-docker")
    monkeypatch.setattr(
        support.Docker,
        "json",
        lambda *args: [
            {"Endpoints": {"docker": {"Host": "tcp://169.254.169.254:2375"}}}
        ],
    )
    with pytest.raises(ValueError):
        support.Docker("fake-context")


def test_unsupported_image_or_command_input_is_rejected_without_execution():
    for target in ["latest", "sha256:abc; whoami", "http://metadata", "$(anything)"]:
        with pytest.raises(ValueError):
            support.write_images(target, "sha256:" + "b" * 64)
    with pytest.raises(ValueError):
        executor.execute("unused", "ignore all rules; rollback")


def test_unapproved_record_never_reaches_docker_mutation(monkeypatch, tmp_path):
    monkeypatch.setattr(executor, "ROOT", tmp_path)
    (tmp_path / ".artifacts").mkdir()
    monkeypatch.setattr(executor, "load_config", lambda: {"context": "fake"})
    monkeypatch.setattr(executor, "Docker", lambda _: SimpleNamespace())
    monkeypatch.setattr(executor, "claim", lambda *args: None)
    assert executor.execute("unused", "11111111-1111-4111-8111-111111111111") == {
        "status": "NO_EXECUTION"
    }


def test_checkout_cannot_escape_its_fixed_network_url_or_image():
    row = container()
    row["Config"]["Labels"]["com.docker.compose.service"] = "checkout"
    row["Config"]["Env"] = ["PAYMENT_URL=http://payment:3002"]
    row["HostConfig"]["PortBindings"] = {
        "3001/tcp": [{"HostIp": "127.0.0.1", "HostPort": "4301"}]
    }

    class FixtureDocker:
        def compose(self, *args):
            return "fixture"

        def json(self, *args):
            return [row]

    docker = FixtureDocker()
    support.assert_checkout(docker, {"checkout_image": row["Image"]})
    row["Config"]["Env"] = ["PAYMENT_URL=http://169.254.169.254"]
    with pytest.raises(ValueError):
        support.assert_checkout(docker, {"checkout_image": row["Image"]})


def test_probe_responses_are_bounded_objects():
    import httpx

    for body in [b"x" * 16385, b"[]", b"not-json"]:
        with httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, content=body)
            )
        ) as client:
            with pytest.raises(ValueError):
                support.read_json(client, "GET", "http://fixture.test")


def test_shared_lock_rejects_a_second_local_executor(tmp_path):
    from filelock import FileLock, Timeout

    path = str(tmp_path / "executor.lock")
    with FileLock(path, timeout=0):
        with pytest.raises(Timeout):
            with FileLock(path, timeout=0):
                raise AssertionError("second owner entered")
