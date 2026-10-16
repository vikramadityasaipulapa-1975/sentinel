"""Cumulative API/database tests and task-specific P3.1/P3.2/P3.3 runtime checks."""

import argparse
import hashlib
import json
import os
import secrets
import shutil
import socket
import subprocess
import time
from datetime import UTC, datetime
from urllib.error import HTTPError
from urllib.request import Request, urlopen
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


class ApiClient:
    def __init__(self, port):
        self.port = port
        self.token = None

    def request(self, path, method="GET", body=None):
        headers = {"content-type": "application/json"}
        if self.token:
            headers["authorization"] = "Bearer " + self.token
        request = Request(
            f"http://127.0.0.1:{self.port}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
            method=method,
        )
        try:
            response = urlopen(request, timeout=10)
        except HTTPError as error:
            response = error
        with response:
            payload = response.read(65537)
            if len(payload) > 65536:
                raise ValueError("API response exceeded verifier limit")
            return response.status, json.loads(payload)

    def incident(self, path, method="GET", body=None):
        return self.request("/api/v1/incidents" + path, method, body)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["P3.1", "P3.2", "P3.3"], default="P3.3")
    task = parser.parse_args().task
    artifacts = ROOT / ".artifacts"
    artifacts.mkdir(exist_ok=True)
    task_slug = task.lower().replace(".", "-")
    directory = artifacts / f"{task_slug}-{uuid4().hex[:8]}"
    directory.mkdir()
    project = "sentinel-" + directory.name
    report = {
        "task": task,
        "run_at": datetime.now(UTC).isoformat(),
        "status": "RUNNING",
        "project": project,
        "artifact_directory": directory.name,
    }
    report_path = artifacts / f"{task_slug}-verification.json"
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
            SENTINEL_JWT_SECRET=secrets.token_hex(32),
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
        print(
            f"{task}: running cumulative unit and real-database integration tests",
            flush=True,
        )
        run([npm, "run", "test:api"], env)
        report["unit_and_database_tests"] = True
        digest = hashlib.sha256()
        paths = (
            list((ROOT / "apps/api/src").glob("*.ts"))
            + list((ROOT / "apps/api/database").rglob("*.sql"))
            + list((ROOT / "apps/api/public").glob("*"))
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
        account_password = secrets.token_urlsafe(24)
        subprocess.run(
            [node, "apps/api/dist/src/user-cli.js"],
            cwd=ROOT,
            env=env,
            input=json.dumps(
                {
                    "action": "create",
                    "email": "runtime-operator@example.test",
                    "password": account_password,
                    "role": "OPERATOR",
                }
            ),
            text=True,
            check=True,
            timeout=30,
        )
        report["explicit_cli_test_account"] = True
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
            client = ApiClient(api_port)
            assert client.request("/api/v1/services")[0] == 401
            status, login = client.request(
                "/api/v1/auth/login",
                "POST",
                {
                    "email": "runtime-operator@example.test",
                    "password": account_password,
                },
            )
            assert status == 200 and login["user"]["role"] == "OPERATOR"
            client.token = login["access_token"]
            report["authenticated_runtime"] = True
            status, original = client.request("/api/v1/services")
            assert status == 200 and len(original["services"]) == 2
            incident = history = None
            if task in {"P3.2", "P3.3"}:
                status, incident = client.incident(
                    "",
                    "POST",
                    {
                        "service_id": original["services"][0]["id"],
                        "title": "Verifier demo: restart persistence",
                        "severity": "HIGH",
                    },
                )
                assert status == 201 and incident["status"] == "OPEN"
                status, incident = client.incident(
                    f"/{incident['id']}", "PATCH", {"status": "INVESTIGATING"}
                )
                assert status == 200 and incident["status"] == "INVESTIGATING"
                status, history = client.incident(f"/{incident['id']}/events")
                assert status == 200 and len(history["events"]) == 2
                assert (
                    client.incident(
                        f"/{incident['id']}", "PATCH", {"status": "CLOSED"}
                    )[0]
                    == 409
                )
                assert client.incident(f"/{incident['id']}/events")[1] == history
                report["incident_http_contracts"] = True
            stop(child)
            child = launch()
            ready(api_port, child)
            assert client.request("/api/v1/services")[1] == original
            if incident:
                assert client.incident(f"/{incident['id']}")[1] == incident
                assert client.incident(f"/{incident['id']}/events")[1] == history
                report["incident_api_restart_persistence"] = True
            report["api_restart_persistence"] = True
            run(command + ["stop", "api-db"], env)
            assert http(api_port, "/health")[0] == 200
            assert http(api_port, "/ready")[0] == 503
            status, body = client.request("/api/v1/services")
            assert status == 503 and body["error"]["code"] == "AUTH_UNAVAILABLE"
            assert password not in json.dumps(body)
            if incident:
                assert client.incident("")[0] == 503
                assert client.incident(f"/{incident['id']}/events")[0] == 503
                assert (
                    client.incident(
                        f"/{incident['id']}",
                        "PATCH",
                        {"status": "MITIGATING"},
                    )[0]
                    == 503
                )
            report["live_database_outage"] = True
            run(
                command + ["up", "-d", "--wait", "--wait-timeout", "60", "api-db"],
                env,
                120,
            )
            ready(api_port, child)
            assert client.request("/api/v1/services")[1] == original
            if incident:
                assert client.incident(f"/{incident['id']}")[1] == incident
                assert client.incident(f"/{incident['id']}/events")[1] == history
                report["incident_database_restart_persistence"] = True
                report["event_history_replay"] = True
            report["database_restart_persistence"] = True
            assert http(api_port, "/unknown")[0] == 404
            if task == "P3.3":
                report["token_survived_restart"] = (
                    client.request("/api/v1/auth/me")[0] == 200
                )
                assert report["token_survived_restart"]
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
        raise RuntimeError(f"{task} cleanup failed")
    print(f"PASS: {task} verification; see {report_path.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
