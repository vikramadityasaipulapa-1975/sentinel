"""P3.1: isolated real PostgreSQL tests, process/database restart and outage checks."""

import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import time
from datetime import UTC, datetime
from uuid import uuid4

from local_support import ROOT, docker_executable, http


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def run(args, env, timeout=120):
    subprocess.run(args, cwd=ROOT, env=env, check=True, timeout=timeout)


def ready(port, child):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError("API exited before readiness")
        try:
            if http(port, "/ready")[0] == 200:
                return
        except OSError:
            pass
        time.sleep(0.2)
    raise TimeoutError("API readiness timed out")


def stop(child):
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


def main():
    artifacts = ROOT / ".artifacts"
    artifacts.mkdir(exist_ok=True)
    directory = artifacts / f"p3-1-{uuid4().hex[:8]}"
    directory.mkdir()
    project = "sentinel-" + directory.name
    report = {
        "task": "P3.1",
        "run_at": datetime.now(UTC).isoformat(),
        "status": "RUNNING",
        "project": project,
        "artifact_directory": directory.name,
    }
    report_path = artifacts / "p3-1-verification.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    child = None
    started = False
    command = None
    env = dict(os.environ)
    try:
        node = shutil.which("node")
        npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
        if not node or not npm:
            raise RuntimeError("Node and npm are required")
        db_port, api_port = free_port(), free_port()
        while db_port == api_port:
            api_port = free_port()
        password = secrets.token_hex(24)
        url = f"postgresql://sentinel_api:{password}@127.0.0.1:{db_port}/sentinel_api_verify"
        env.update(
            SENTINEL_POSTGRES_PASSWORD=password,
            SENTINEL_DB_PORT=str(db_port),
            SENTINEL_DB_NAME="sentinel_api_verify",
            SENTINEL_DATABASE_URL=url,
            SENTINEL_DATABASE_TLS="disable",
            SENTINEL_API_PORT=str(api_port),
            TEST_API_DATABASE_URL=url,
        )
        env.pop("SENTINEL_DATABASE_CA", None)
        command = [
            docker_executable(),
            "compose",
            "-f",
            str(ROOT / "infrastructure/compose.api.yaml"),
            "-p",
            project,
        ]
        run(command + ["config", "--quiet"], env)
        started = True
        run(
            command + ["up", "-d", "--wait", "--wait-timeout", "60", "api-db"], env, 300
        )
        print("P3.1: running unit and real-database integration tests", flush=True)
        run([npm, "run", "test:api"], env)
        report["unit_and_database_tests"] = True
        digest = hashlib.sha256()
        paths = (
            list((ROOT / "apps/api/src").glob("*.ts"))
            + list((ROOT / "apps/api/database").rglob("*.sql"))
            + [ROOT / "package-lock.json"]
        )
        for path in sorted(paths):
            digest.update(
                path.relative_to(ROOT).as_posix().encode()
                + b"\0"
                + path.read_bytes().replace(b"\r\n", b"\n")
                + b"\0"
            )
        report["runtime_source_sha256"] = digest.hexdigest()
        with (directory / "api.log").open("w", encoding="utf-8") as log:

            def launch():
                return subprocess.Popen(
                    [node, "apps/api/dist/src/server.js"],
                    cwd=ROOT,
                    env=env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                )

            child = launch()
            ready(api_port, child)
            status, original = http(api_port, "/api/v1/services")
            assert status == 200 and len(original["services"]) == 2
            stop(child)
            child = launch()
            ready(api_port, child)
            assert http(api_port, "/api/v1/services")[1] == original
            report["api_restart_persistence"] = True
            run(command + ["stop", "api-db"], env)
            assert http(api_port, "/health")[0] == 200
            assert http(api_port, "/ready")[0] == 503
            status, body = http(api_port, "/api/v1/services")
            assert status == 503 and body["error"]["code"] == "DATABASE_UNAVAILABLE"
            assert password not in json.dumps(body)
            report["live_database_outage"] = True
            run(
                command + ["up", "-d", "--wait", "--wait-timeout", "60", "api-db"],
                env,
                120,
            )
            ready(api_port, child)
            assert http(api_port, "/api/v1/services")[1] == original
            report["database_restart_persistence"] = True
            assert http(api_port, "/unknown")[0] == 404
            report["status"] = "PASSED"
    except Exception as error:
        report.update(status="FAILED", error_type=type(error).__name__)
        raise
    finally:
        stop(child)
        if started and command:
            try:
                # Only this verifier's project; retain the volume, never use -v.
                run(command + ["down"], env)
                report["test_containers_removed_volume_preserved"] = True
            except Exception:
                report["status"] = "FAILED"
                report["cleanup_failed"] = True
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    if report["status"] != "PASSED":
        raise RuntimeError("P3.1 cleanup failed")
    print("PASS: P3.1 verification; see .artifacts/p3-1-verification.json", flush=True)


if __name__ == "__main__":
    main()
