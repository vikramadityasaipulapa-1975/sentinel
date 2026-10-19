"""Real isolated Express/FastAPI resilience check; memory-only simulated payments."""

import json
import os
import socket
import subprocess
import sys
import sysconfig
import time
from uuid import uuid4

from local_support import ROOT
from observability_support import http, wait
from shutil import which


def main():
    probes = [socket.socket(), socket.socket()]
    try:
        for probe in probes:
            probe.bind(("127.0.0.1", 0))
        payment_port, checkout_port = [probe.getsockname()[1] for probe in probes]
    finally:
        for probe in probes:
            probe.close()
    directory = ROOT / ".artifacts" / ("p10-resilience-" + uuid4().hex[:12])
    directory.mkdir(parents=True)
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(("SENTINEL_", "PAYMENT_", "OTEL_"))
    }
    env.update(
        PYTHONPATH=sysconfig.get_path("purelib"),
        STORAGE_MODE="memory",
        PAYMENT_VERSION="unversioned",
        SOURCE_SHA256="unknown",
        GIT_COMMIT="unknown",
        DEPLOYMENT_ID="unregistered",
        PAYMENT_URL=f"http://127.0.0.1:{payment_port}",
        PAYMENT_TIMEOUT_MS="2000",
        PAYMENT_MAX_ATTEMPTS="1",
        PAYMENT_TOTAL_TIMEOUT_MS="400",
        PAYMENT_MAX_INFLIGHT="1",
        PAYMENT_CIRCUIT_ENABLED="true",
        PAYMENT_CIRCUIT_FAILURE_THRESHOLD="2",
        PAYMENT_CIRCUIT_COOLDOWN_MS="5000",
        PAYMENT_FAULT_DELAY_MS="2500",
    )
    children, logs = [], []
    payment = None
    report = {
        "status": "RUNNING",
        "kind": "real isolated Express/FastAPI; simulated payments; no database/collector/model/executor",
        "directory": directory.name,
    }

    def stop(child):
        if child and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)

    def launch(label, argv):
        log = (directory / (label + ".log")).open("a", encoding="utf-8")
        logs.append(log)
        child = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=log, stderr=log)
        children.append(child)
        return child

    def mode(value):
        nonlocal payment
        stop(payment)
        env["PAYMENT_FAULT_MODE"] = value
        payment = launch(
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
                str(payment_port),
                "--no-access-log",
            ],
        )
        wait(
            lambda: payment.poll() is None and http(payment_port, "/health")[0] == 200,
            30,
        )

    def checkout():
        return http(
            checkout_port,
            "/checkout",
            {"order_id": str(uuid4()), "amount_minor": 100, "currency": "INR"},
        )

    try:
        node = which("node")
        if not node:
            raise RuntimeError("Node required")
        mode("error")
        script = (
            "import {createApp} from './services/checkout-service/dist/src/app.js'; createApp().listen("
            + str(checkout_port)
            + ",'127.0.0.1');"
        )
        child = launch("checkout", [node, "--input-type=module", "-e", script])
        wait(
            lambda: child.poll() is None and http(checkout_port, "/health")[0] == 200,
            30,
        )
        for _ in range(2):
            assert checkout()[0] == 502
        code, body = checkout()
        assert code == 503 and body["error"]["code"] == "PAYMENT_CIRCUIT_OPEN"
        assert http(checkout_port, "/health")[0] == 200
        report["real_failures_open_circuit"] = True
        mode("normal")
        wait(lambda: checkout()[0] == 201, 15)
        report["real_recovery_probe_closes_circuit"] = True
        mode("latency")
        begin = time.monotonic()
        code, body = checkout()
        elapsed = time.monotonic() - begin
        assert code == 504 and body["error"]["code"] == "PAYMENT_BUDGET_EXHAUSTED"
        assert elapsed < 1.5
        report["real_latency_budget_seconds"] = round(elapsed, 3)
        assert http(checkout_port, "/health")[0] == 200
        mode("normal")
        assert checkout()[0] == 201
        report["capacity_released_and_health_responsive"] = True
        report["status"] = "PASSED"
    except BaseException as error:
        report.update(status="FAILED", error_type=type(error).__name__)
        raise
    finally:
        from quality_support import cleanup_owned

        failed = cleanup_owned(
            [("child", lambda child=child: stop(child)) for child in reversed(children)]
            + [("log", log.close) for log in logs]
        )
        report["owned_processes_stopped"] = not failed
        if failed:
            report.update(status="FAILED", cleanup_failures=failed)
        (ROOT / ".artifacts/p10-resilience-verification.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        if failed:
            raise RuntimeError("Owned resilience fixture cleanup failed")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
