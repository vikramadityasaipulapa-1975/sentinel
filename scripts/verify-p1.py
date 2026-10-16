"""Run local regressions and real two-runtime scenarios; stop only owned children."""

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / ".artifacts"
PAYMENT = {
    "order_id": "11111111-1111-4111-8111-111111111111",
    "amount_minor": 12500,
    "currency": "INR",
}


def request(port, path, body=None, request_id=None):
    headers = {"x-request-id": request_id or str(uuid4())}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    req = Request(f"http://127.0.0.1:{port}{path}", data=data, headers=headers)
    start = time.perf_counter()
    try:
        response = urlopen(req, timeout=5)
    except HTTPError as error:
        response = error
    with response:
        result = json.loads(response.read(16385))
        return (
            response.status,
            result,
            response.headers,
            (time.perf_counter() - start) * 1000,
        )


def wait_ready(process, port):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"Child exited before port {port} was ready; inspect .artifacts logs"
            )
        try:
            if request(port, "/health")[0] == 200:
                return
        except (URLError, OSError):
            pass
        time.sleep(0.1)
    raise TimeoutError(f"Service readiness timed out on {port}")


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def records(path):
    output = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            output.append(json.loads(line))
        except json.JSONDecodeError:
            pass  # Uvicorn lifecycle diagnostics are not application JSON logs.
    return output


def run_scenario(name, mode, expected, delay, timeout, k6):
    scenario = {"name": name, "mode": mode, "expected_status": expected, "samples": []}
    payment_log = ARTIFACTS / f"{name}-payment.log"
    checkout_log = ARTIFACTS / f"{name}-checkout.log"
    ids = []
    with ExitStack() as stack:
        children = []
        try:
            base_env = {
                **os.environ,
                "PAYMENT_FAULT_MODE": mode,
                "PAYMENT_FAULT_DELAY_MS": str(delay),
                "STORAGE_MODE": "memory",
                "PAYMENT_VERSION": "unversioned",
                "SOURCE_SHA256": "unknown",
                "GIT_COMMIT": "unknown",
                "DEPLOYMENT_ID": "unregistered",
                "PAYMENT_MAX_ATTEMPTS": "1",
            }
            flags = (
                {"creationflags": subprocess.CREATE_NO_WINDOW}
                if os.name == "nt"
                else {}
            )
            if mode != "unavailable":
                handle = stack.enter_context(payment_log.open("w", encoding="utf-8"))
                payment_process = subprocess.Popen(
                    [
                        sys.executable,
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
                    cwd=ROOT,
                    env=base_env,
                    stdout=handle,
                    stderr=handle,
                    **flags,
                )
                children.append(payment_process)
                wait_ready(payment_process, 3002)
                assert "/payments" in request(3002, "/openapi.json")[1]["paths"]
                assert request(3002, "/payments", {})[0] == 422
            handle = stack.enter_context(checkout_log.open("w", encoding="utf-8"))
            checkout_process = subprocess.Popen(
                ["node", "services/checkout-service/dist/src/server.js"],
                cwd=ROOT,
                env={
                    **base_env,
                    "PAYMENT_URL": "http://127.0.0.1:3002",
                    "PAYMENT_TIMEOUT_MS": str(timeout),
                },
                stdout=handle,
                stderr=handle,
                **flags,
            )
            children.append(checkout_process)
            wait_ready(checkout_process, 3001)
            if name == "normal-a":
                duplicate = subprocess.run(
                    ["node", "services/checkout-service/dist/src/server.js"],
                    cwd=ROOT,
                    env={**base_env, "PAYMENT_TIMEOUT_MS": "2000"},
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                assert duplicate.returncode == 1 and "EADDRINUSE" in duplicate.stderr
                invalid = subprocess.run(
                    ["node", "services/checkout-service/dist/src/server.js"],
                    cwd=ROOT,
                    env={**base_env, "PAYMENT_URL": "secret-marker"},
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                assert (
                    invalid.returncode == 1
                    and "INVALID_CONFIGURATION" in invalid.stderr
                )
                assert "secret-marker" not in invalid.stderr
                scenario["startup_failure_checks_verified"] = True
            assert request(3001, "/unknown?token=secret-marker")[0] == 404
            assert request(3001, "/checkout", {"secret": "secret-marker"})[0] == 422
            for _ in range(3):
                request_id = str(uuid4())
                status, body, headers, elapsed = request(
                    3001, "/checkout", PAYMENT, request_id
                )
                assert status == expected, (name, status, body)
                assert headers["x-request-id"] == request_id
                if expected == 201:
                    assert body["status"] == "succeeded"
                    assert body["amount_minor"] == PAYMENT["amount_minor"]
                    if mode == "latency":
                        assert elapsed >= delay * 0.8, elapsed
                else:
                    assert body["request_id"] == request_id
                    assert body["error"]["code"] == (
                        "PAYMENT_TIMEOUT"
                        if expected == 504
                        else "PAYMENT_UNAVAILABLE"
                        if mode == "unavailable"
                        else "PAYMENT_BAD_RESPONSE"
                    )
                scenario["samples"].append(
                    {"status": status, "elapsed_ms": round(elapsed, 2)}
                )
                ids.append(request_id)
            if k6:
                summary = ARTIFACTS / f"k6-{name}.json"
                subprocess.run(
                    [
                        k6,
                        "run",
                        "--no-usage-report",
                        "--summary-export",
                        str(summary),
                        "--env",
                        f"EXPECT_STATUS={expected}",
                        "scripts/load-checkout.js",
                    ],
                    cwd=ROOT,
                    check=True,
                    timeout=60,
                    env={
                        **base_env,
                        "CHECKOUT_URL": "http://127.0.0.1:3001",
                        "MAX_P95_MS": "3000",
                    },
                )
                metrics = json.loads(summary.read_text(encoding="utf-8"))["metrics"]
                scenario["load"] = {
                    "requests": metrics["http_reqs"]["count"],
                    "expected_status_rate": metrics["expected_status"]["value"],
                    "p95_ms": metrics["http_req_duration"]["p(95)"],
                }
            if mode == "latency":
                time.sleep(
                    delay / 1000 + 0.1
                )  # Let timed-out downstream calls finish their logs.
        finally:
            for child in reversed(children):
                stop(child)
    checkout_records = records(checkout_log)
    payment_records = records(payment_log) if mode != "unavailable" else []
    for request_id in ids:
        assert any(
            r.get("event") == "request_completed" and r.get("request_id") == request_id
            for r in checkout_records
        )
        if mode != "unavailable":
            assert any(
                r.get("event") == "request_completed"
                and r.get("request_id") == request_id
                for r in payment_records
            )
    for path in [checkout_log] + ([payment_log] if mode != "unavailable" else []):
        assert "secret-marker" not in path.read_text(encoding="utf-8")
    scenario["correlation_verified"] = True
    print(
        f"PASS: {name} ({len(ids)} real checkouts, shared IDs and safe logs)",
        flush=True,
    )
    return scenario


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-k6",
        action="store_true",
        help="Explicitly skip load checks; report this limitation",
    )
    args = parser.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)
    report = {
        "run_at": datetime.now(UTC).isoformat(),
        "status": "RUNNING",
        "k6_skipped": args.skip_k6,
        "scenarios": [],
    }
    report_path = ARTIFACTS / "p1-verification.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    k6 = shutil.which("k6") or str(ROOT / ".tools/k6/k6-v1.8.2-windows-amd64/k6.exe")
    if not args.skip_k6 and not Path(k6).is_file():
        raise RuntimeError(
            "Install k6 using scripts/setup-k6.ps1 or use --skip-k6 explicitly"
        )
    # Refuse to touch someone else's listener. Ports are local and fixed in P1.
    for port in (3001, 3002):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    test_env = dict(os.environ)
    for key in (
        "PAYMENT_URL",
        "PAYMENT_TIMEOUT_MS",
        "PAYMENT_FAULT_MODE",
        "PAYMENT_FAULT_DELAY_MS",
        "STORAGE_MODE",
        "DATABASE_URL",
        "PAYMENT_VERSION",
        "SOURCE_SHA256",
        "GIT_COMMIT",
        "DEPLOYMENT_ID",
        "PAYMENT_MAX_ATTEMPTS",
    ):
        test_env.pop(key, None)
    npm_command = (
        ["cmd.exe", "/d", "/c", "npm test"] if os.name == "nt" else ["npm", "test"]
    )
    subprocess.run(npm_command, cwd=ROOT, env=test_env, check=True, timeout=60)
    format_command = (
        ["cmd.exe", "/d", "/c", "npm run format:check"]
        if os.name == "nt"
        else ["npm", "run", "format:check"]
    )
    subprocess.run(format_command, cwd=ROOT, env=test_env, check=True, timeout=30)
    subprocess.run(
        [sys.executable, "-m", "pytest", "services/payment-service", "-q"],
        cwd=ROOT,
        env=test_env,
        check=True,
        timeout=60,
    )
    subprocess.run(
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            "services/payment-service",
            "scripts/verify-p1.py",
        ],
        cwd=ROOT,
        check=True,
        timeout=30,
    )
    subprocess.run(
        [
            sys.executable,
            "-m",
            "ruff",
            "format",
            "--check",
            "services/payment-service",
            "scripts/verify-p1.py",
        ],
        cwd=ROOT,
        check=True,
        timeout=30,
    )
    if not args.skip_k6:
        for environment in [
            "CHECKOUT_URL=http://example.com:3001",
            "EXPECT_STATUS=400",
        ]:
            rejected = subprocess.run(
                [
                    k6,
                    "run",
                    "--no-usage-report",
                    "--env",
                    environment,
                    "scripts/load-checkout.js",
                ],
                cwd=ROOT,
                env={**test_env, "CHECKOUT_URL": "http://127.0.0.1:3001"},
                capture_output=True,
                text=True,
                timeout=15,
            )
            assert rejected.returncode != 0, (
                "Load input guard unexpectedly accepted invalid configuration"
            )
        report["load_input_guards_verified"] = True
    for name, mode, expected, delay, timeout, load in [
        ("normal-a", "normal", 201, 500, 2000, True),
        ("normal-b", "normal", 201, 500, 2000, False),
        ("error-a", "error", 502, 500, 2000, True),
        ("error-b", "error", 502, 500, 2000, False),
        ("latency", "latency", 201, 100, 2000, False),
        ("timeout", "latency", 504, 600, 200, True),
        ("unavailable", "unavailable", 502, 500, 2000, False),
    ]:
        report["scenarios"].append(
            run_scenario(
                name,
                mode,
                expected,
                delay,
                timeout,
                k6 if load and not args.skip_k6 else None,
            )
        )
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    report["status"] = "PASSED_WITH_LIMITATIONS" if args.skip_k6 else "PASSED"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("PASS: P1 verification. Evidence: .artifacts/p1-verification.json")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        report_path = ARTIFACTS / "p1-verification.json"
        if report_path.exists():
            failed_report = json.loads(report_path.read_text(encoding="utf-8"))
            failed_report.update(status="FAILED", error_type=type(error).__name__)
            report_path.write_text(
                json.dumps(failed_report, indent=2) + "\n", encoding="utf-8"
            )
        raise
