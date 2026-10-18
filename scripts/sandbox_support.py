"""Fixed sandbox Docker operations; no caller-provided commands, hosts or paths."""

import hashlib
import json
import os
import subprocess
import time
from uuid import uuid4

import httpx
from local_support import ROOT, docker_executable

PROJECT = "sentinel-remediation-sandbox"
COMPOSE = ROOT / "infrastructure/compose.sandbox.yaml"
CONFIG = ROOT / ".artifacts/p8-sandbox.json"
ENV_FILE = ROOT / ".env.sandbox"


class Docker:
    def __init__(self, context):
        self.executable = docker_executable()
        self.context = context
        self.env = {
            key: value
            for key, value in os.environ.items()
            if key.upper()
            in {
                "PATH",
                "SYSTEMROOT",
                "WINDIR",
                "TEMP",
                "TMP",
                "USERPROFILE",
                "APPDATA",
                "LOCALAPPDATA",
                "HOME",
            }
        }
        info = self.json("context", "inspect", context)[0]
        host = info["Endpoints"]["docker"]["Host"]
        if host not in {
            "npipe:////./pipe/dockerDesktopLinuxEngine",
            "npipe:////./pipe/docker_engine",
            "unix:///var/run/docker.sock",
        }:
            raise ValueError("Only the approved local Docker engine is supported")

    def run(self, *args, timeout=35):
        result = subprocess.run(
            [self.executable, "--context", self.context, *args],
            cwd=ROOT,
            env=self.env,
            check=True,
            timeout=timeout,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if len(result.stdout) > 262144:
            raise ValueError("Docker response too large")
        return result.stdout.decode("utf-8")

    def json(self, *args):
        return json.loads(self.run(*args))

    def compose(self, *args):
        return self.run(
            "compose",
            "--project-name",
            PROJECT,
            "--env-file",
            str(ENV_FILE),
            "-f",
            str(COMPOSE),
            *args,
        )

    def payment(self):
        identifier = self.compose("ps", "-q", "payment").strip()
        if not identifier:
            raise ValueError("Sandbox payment is missing")
        return self.json("inspect", identifier)[0]


def assert_container(row, image, container_id=None):
    labels = row["Config"].get("Labels", {})
    if (
        labels.get("com.docker.compose.project") != PROJECT
        or labels.get("com.docker.compose.service") != "payment"
        or row["Image"] != image
        or (container_id and row["Id"] != container_id)
    ):
        raise ValueError("Sandbox identity changed")
    if (
        row["HostConfig"].get("Privileged")
        or row["Mounts"]
        and any(m["Type"] != "tmpfs" for m in row["Mounts"])
    ):
        raise ValueError("Unexpected sandbox privileges or mounts")
    if not row["HostConfig"].get("ReadonlyRootfs") or set(
        row["HostConfig"].get("CapDrop") or []
    ) != {"ALL"}:
        raise ValueError("Sandbox hardening changed")
    env = dict(item.split("=", 1) for item in row["Config"]["Env"] if "=" in item)
    if (
        env.get("STORAGE_MODE") != "memory"
        or env.get("DEPLOYMENT_ID") != "88888888-8888-4888-8888-888888888888"
        or env.get("DATABASE_URL")
    ):
        raise ValueError("Sandbox must use disposable simulated memory storage")
    ports = row["HostConfig"]["PortBindings"]
    if ports != {"3002/tcp": [{"HostIp": "127.0.0.1", "HostPort": "4302"}]}:
        raise ValueError("Unexpected sandbox port")


def probe(expected_version, samples=3):
    observations = {
        "version_matches": False,
        "ready": False,
        "successful_checkouts": 0,
        "samples": samples,
    }
    with httpx.Client(trust_env=False, timeout=2, follow_redirects=False) as client:
        version = client.get("http://127.0.0.1:4302/version")
        observations["version_matches"] = (
            version.status_code == 200
            and version.json().get("version") == expected_version
            and version.json().get("deployment_id")
            == "88888888-8888-4888-8888-888888888888"
        )
        observations["ready"] = (
            client.get("http://127.0.0.1:4302/ready").status_code == 200
        )
        for _ in range(samples):
            order = str(uuid4())
            response = client.post(
                "http://127.0.0.1:4301/checkout",
                headers={"Idempotency-Key": str(uuid4())},
                json={"order_id": order, "amount_minor": 100, "currency": "INR"},
            )
            data = response.json()
            if (
                response.status_code == 201
                and data.get("order_id") == order
                and data.get("status") == "succeeded"
            ):
                observations["successful_checkouts"] += 1
    return observations


def wait_version(version):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            with httpx.Client(
                trust_env=False, timeout=1, follow_redirects=False
            ) as client:
                r = client.get("http://127.0.0.1:4302/version")
                if r.status_code == 200 and r.json().get("version") == version:
                    return
        except (httpx.HTTPError, ValueError):
            pass
        time.sleep(0.3)
    raise TimeoutError("Sandbox runtime identity unavailable")


def compose_hash():
    return hashlib.sha256(COMPOSE.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def load_config():
    value = json.loads(CONFIG.read_text(encoding="utf-8"))
    if (
        value["compose_sha256"] != compose_hash()
        or value["binding"]["project"] != PROJECT
    ):
        raise ValueError("Sandbox setup is stale; prepare again")
    return value


def write_images(payment, checkout):
    import re

    if not all(
        re.fullmatch(r"sha256:[0-9a-f]{64}", item) for item in [payment, checkout]
    ):
        raise ValueError("Only immutable local image IDs are accepted")
    ENV_FILE.write_text(
        f"SANDBOX_PAYMENT_IMAGE={payment}\nSANDBOX_CHECKOUT_IMAGE={checkout}\n",
        encoding="utf-8",
    )
