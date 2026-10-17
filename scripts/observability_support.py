"""Owned, bounded local demo processes and collector operations. No production targets."""

import json
import os
import shutil
import socket
import subprocess
import sys
import sysconfig
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from uuid import uuid4

from local_support import ROOT, docker_executable

DATA = ROOT / ".artifacts/observability"


def compose(*args):
    return [
        docker_executable(),
        "compose",
        "-f",
        str(ROOT / "infrastructure/compose.observability.yaml"),
        *args,
    ]


def run(args, timeout=300):
    subprocess.run(args, cwd=ROOT, check=True, timeout=timeout)


def http(port, path, body=None, headers=None, method=None):
    raw = json.dumps(body).encode() if body is not None else None
    request = Request(
        f"http://127.0.0.1:{port}{path}",
        data=raw,
        method=method,
        headers={
            **({"content-type": "application/json"} if raw else {}),
            **(headers or {}),
        },
    )
    try:
        response = urlopen(request, timeout=8)
    except HTTPError as error:
        response = error
    with response:
        content = response.read(4_000_000)
        return response.status, json.loads(content) if "json" in response.headers.get(
            "content-type", ""
        ) else content.decode()


def wait(check, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(0.5)
    raise TimeoutError("Local observability condition timed out")


def query(expression):
    status, result = http(9090, "/api/v1/query?" + urlencode({"query": expression}))
    assert status == 200, result
    return result["data"]["result"]


def checkout():
    return http(
        3001,
        "/checkout",
        {"order_id": str(uuid4()), "amount_minor": 12500, "currency": "INR"},
    )


class Demo:
    def __init__(self):
        self.children = {}
        self.logs = []

    def __enter__(self):
        for port in (3001, 3002):
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        DATA.mkdir(parents=True, exist_ok=True)
        (DATA / "logs").mkdir(exist_ok=True)
        self.env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("SENTINEL_")
        }
        self.env["PYTHONPATH"] = sysconfig.get_path("purelib")
        self.env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] = (
            "http://127.0.0.1:4418/v1/traces"
        )
        self.env.update(
            STORAGE_MODE="memory",
            PAYMENT_FAULT_MODE="normal",
            PAYMENT_FAULT_DELAY_MS="2500",
            PAYMENT_VERSION="unversioned",
            SOURCE_SHA256="unknown",
            GIT_COMMIT="unknown",
            DEPLOYMENT_ID="unregistered",
            PAYMENT_URL="http://127.0.0.1:3002",
            PAYMENT_TIMEOUT_MS="1000",
            PAYMENT_MAX_ATTEMPTS="1",
        )
        try:
            self.payment("normal")
            self.launch(
                "checkout",
                [shutil.which("node"), "services/checkout-service/dist/src/server.js"],
            )
            wait(lambda: http(3001, "/health")[0] == 200)
            return self
        except BaseException:
            self.__exit__(None, None, None)
            raise

    def launch(self, name, args):
        log = (DATA / "logs" / f"{name}.log").open("a", encoding="utf-8")
        self.logs.append(log)
        self.children[name] = subprocess.Popen(
            args, cwd=ROOT, env=self.env, stdout=log, stderr=log
        )

    def payment(self, mode):
        if "payment" in self.children:
            self.stop("payment")
        self.env["PAYMENT_FAULT_MODE"] = mode
        # Run the real interpreter directly so terminating it cannot orphan a venv launcher child.
        self.launch(
            "payment",
            [
                sys._base_executable,
                "-m",
                "uvicorn",
                "main:app",
                "--app-dir",
                "services/payment-service",
                "--host",
                "127.0.0.1",
                "--port",
                "3002",
                "--no-access-log",
            ],
        )
        wait(lambda: http(3002, "/health")[0] == 200)

    def stop(self, name):
        child = self.children.pop(name)
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)

    def __exit__(self, *_):
        for name in list(self.children):
            self.stop(name)
        for log in self.logs:
            log.close()


def webhook_secret():
    values = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.api").read_text().splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    import re

    value = values.get("SENTINEL_ALERT_WEBHOOK_SECRET", "")
    if not re.fullmatch("[0-9a-f]{64}", value):
        raise RuntimeError(
            "Run scripts/api-local.py to generate local webhook configuration"
        )
    directory = DATA / "secrets"
    directory.mkdir(exist_ok=True)
    (directory / "webhook-token").write_text(value)
    return value
