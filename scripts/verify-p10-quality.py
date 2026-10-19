"""Nine bounded live local trials. Never targets a hosted service or user DB."""

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import sysconfig
import time
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import httpx
import psycopg
from psycopg import sql
from local_support import ROOT, docker_executable
from quality_support import cleanup_owned, summarize, write_configs
from observability_support import http

sys.path.insert(0, str(ROOT / "apps/ai-engine"))
from evidence.models import Window
from evidence.prometheus import query_prometheus
from evidence.loki import search_loki
from evidence.deployments import query_deployments
from investigation_graph import run_parallel
from synthesis import synthesize


def settings(name):
    return dict(
        line.split("=", 1)
        for line in (ROOT / name).read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
    )


def free_ports():
    probes = []
    try:
        for _ in range(6):
            probe = socket.socket()
            probe.bind(("127.0.0.1", 0))
            probes.append(probe)
        return dict(
            zip(
                ["api", "payment", "checkout", "prometheus", "alertmanager", "loki"],
                [probe.getsockname()[1] for probe in probes],
            )
        )
    finally:
        for probe in probes:
            probe.close()


def wait(check, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.25)
    raise TimeoutError("Owned quality fixture readiness/deadline exceeded")


def stop(child):
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


async def collect(ports, reader, start, end):
    window = Window(
        service="checkout-service",
        start=datetime.fromtimestamp(start, timezone.utc),
        end=datetime.fromtimestamp(end, timezone.utc),
    )
    async with httpx.AsyncClient(trust_env=False) as client:
        state = await run_parallel(
            window,
            {
                "prometheus": lambda win: query_prometheus(
                    client, f"http://127.0.0.1:{ports['prometheus']}", win
                ),
                "loki": lambda win: search_loki(
                    client, f"http://127.0.0.1:{ports['loki']}", win
                ),
                "deployments": lambda win: query_deployments(reader, win),
            },
        )
    return {
        "analysis": synthesize(state),
        "evidence": [row.model_dump(mode="json") for row in state.evidence],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repetitions", type=int, choices=range(1, 4), default=3)
    args = parser.parse_args()
    owner = settings(".env.api")["SENTINEL_DATABASE_URL"]
    parsed = urlsplit(owner)
    if (
        parsed.hostname != "127.0.0.1"
        or parsed.path != "/sentinel_api"
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Dedicated local API database required")
    reader = settings(".env.evidence")["SENTINEL_DEPLOYMENT_READ_URL"]
    if urlsplit(reader).hostname != "127.0.0.1":
        raise ValueError("Local read-only deployment registry required")
    name = "sentinel_p10_quality_" + uuid4().hex[:12]
    project = name.replace("_", "-")
    directory = ROOT / ".artifacts" / name
    directory.mkdir(parents=True)
    (directory / "logs").mkdir()
    ports = free_ports()
    docker = docker_executable()
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node required; build workspaces first")
    configuration = subprocess.run(
        [
            docker,
            "compose",
            "-f",
            "infrastructure/compose.observability.yaml",
            "config",
            "--format",
            "json",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    images = {
        key: row["image"]
        for key, row in json.loads(configuration.stdout)["services"].items()
    }
    for source, target in [
        ("alerts.yaml", "alerts.yaml"),
        ("loki.yaml", "loki.yaml"),
        ("config.alloy", "config.alloy"),
    ]:
        shutil.copyfile(
            ROOT / "infrastructure/observability" / source, directory / target
        )
    token = secrets.token_hex(32)
    (directory / "token").write_text(token, encoding="utf-8")
    write_configs(directory, ports, images, sys.platform == "linux")
    command = [docker, "compose", "-p", project, "-f", str(directory / "compose.json")]
    base_env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("SENTINEL_")
    }
    base_env["PYTHONPATH"] = sysconfig.get_path("purelib")
    env = {
        **base_env,
        "SENTINEL_DATABASE_URL": urlunsplit(parsed._replace(path="/" + name)),
        "SENTINEL_DATABASE_TLS": "disable",
        "SENTINEL_API_PORT": str(ports["api"]),
        "SENTINEL_JWT_SECRET": secrets.token_hex(32),
        "SENTINEL_ALERT_WEBHOOK_SECRET": token,
        "SENTINEL_QUALITY_DIRECTORY": str(directory),
        "SENTINEL_QUALITY_PASSWORD": secrets.token_urlsafe(24),
    }
    demo_env = {
        **base_env,
        "STORAGE_MODE": "memory",
        "PAYMENT_URL": f"http://127.0.0.1:{ports['payment']}",
        "PAYMENT_TIMEOUT_MS": "1000",
        "PAYMENT_MAX_ATTEMPTS": "1",
        "PAYMENT_CIRCUIT_ENABLED": "false",
        "PAYMENT_FAULT_DELAY_MS": "2500",
        "PAYMENT_VERSION": "unversioned",
        "SOURCE_SHA256": "unknown",
        "GIT_COMMIT": "unknown",
        "DEPLOYMENT_ID": "unregistered",
    }
    children, logs = [], []
    payment = api = None
    created = started = False
    report = {
        "status": "RUNNING",
        "at": datetime.now(timezone.utc).isoformat(),
        "project": project,
        "directory": name,
        "scope": "real local metrics/logs/Prometheus/Alertmanager/HTTP/PostgreSQL; simulated payments; test-only investigation processor, not BullMQ; no chat-model inference or remediation",
        "protocol": {
            "repetitions": args.repetitions,
            "healthy_seconds": 35,
            "fault_seconds": 40,
            "recovery_seconds": 45,
            "target_interval_seconds": 0.5,
            "max_inflight": 1,
            "request_timeout_seconds": 8,
        },
        "trials": [],
    }

    def launch(label, argv, process_env, stdin=None):
        log = (directory / "logs" / (label + ".log")).open("a", encoding="utf-8")
        logs.append(log)
        child = subprocess.Popen(
            argv, cwd=ROOT, env=process_env, stdin=stdin, stdout=log, stderr=log
        )
        children.append(child)
        return child

    def mode(value):
        nonlocal payment
        stop(payment)
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
                str(ports["payment"]),
                "--no-access-log",
            ],
            {**demo_env, "PAYMENT_FAULT_MODE": value},
        )
        wait(
            lambda: (
                payment.poll() is None and http(ports["payment"], "/health")[0] == 200
            )
        )

    try:
        with psycopg.connect(owner, autocommit=True, connect_timeout=3) as admin:
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
            created = True
        api = launch(
            "api", [node, "apps/api/dist/test/quality-fixture.js"], env, subprocess.PIPE
        )
        wait(lambda: api.poll() is None and (directory / "ready").is_file())
        assert http(ports["api"], "/api/v1/services")[0] == 401
        code, login = http(
            ports["api"],
            "/api/v1/auth/login",
            {
                "email": "quality@example.test",
                "password": env["SENTINEL_QUALITY_PASSWORD"],
            },
        )
        assert code == 200
        auth = {"authorization": "Bearer " + login["access_token"]}
        assert (
            http(ports["api"], "/api/v1/webhooks/alertmanager", {}, method="POST")[0]
            == 401
        )
        mode("normal")
        script = (
            "import {createApp} from './services/checkout-service/dist/src/app.js'; createApp().listen("
            + str(ports["checkout"])
            + ",'127.0.0.1');"
        )
        checkout_child = launch(
            "checkout", [node, "--input-type=module", "-e", script], demo_env
        )
        wait(
            lambda: (
                checkout_child.poll() is None
                and http(ports["checkout"], "/health")[0] == 200
            )
        )
        started = True
        subprocess.run(command + ["up", "-d"], cwd=ROOT, check=True, timeout=180)
        for label, path in [
            ("prometheus", "/-/ready"),
            ("alertmanager", "/-/ready"),
            ("loki", "/ready"),
        ]:
            wait(lambda label=label, path=path: http(ports[label], path)[0] == 200, 90)
        with psycopg.connect(env["SENTINEL_DATABASE_URL"], autocommit=True) as db:

            def episodes():
                return db.execute(
                    "SELECT a.incident_id,a.signal_status,i.status FROM sentinel_api.alert_episodes a JOIN sentinel_api.incidents i ON i.id=a.incident_id ORDER BY a.starts_at"
                ).fetchall()

            def traffic(seconds, on_tick=lambda: None):
                begin = time.monotonic()
                counts = Counter()
                while time.monotonic() - begin < seconds:
                    tick = time.monotonic()
                    code, _ = http(
                        ports["checkout"],
                        "/checkout",
                        {
                            "order_id": str(uuid4()),
                            "amount_minor": 100,
                            "currency": "INR",
                        },
                    )
                    counts[str(code)] += 1
                    on_tick()
                    time.sleep(max(0, 0.5 - (time.monotonic() - tick)))
                elapsed = time.monotonic() - begin
                return {
                    "responses": dict(counts),
                    "requests": sum(counts.values()),
                    "elapsed_seconds": round(elapsed, 3),
                    "achieved_rps": round(sum(counts.values()) / elapsed, 3),
                }

            for repetition in range(1, args.repetitions + 1):
                for scenario, cause, fault in [
                    ("healthy", None, "normal"),
                    ("payment-error", "dependency", "error"),
                    ("payment-timeout", "dependency", "latency"),
                ]:
                    mode(fault)
                    previous = {row[0] for row in episodes()}
                    start_wall, start_mono = time.time(), time.monotonic()
                    row = {
                        "repetition": repetition,
                        "scenario": scenario,
                        "expected_cause": cause,
                        "detection_seconds": None,
                        "report_saved": False,
                        "top_category": None,
                    }
                    report["trials"].append(row)

                    def observe():
                        if row["detection_seconds"] is None and any(
                            item[0] not in previous for item in episodes()
                        ):
                            row["detection_seconds"] = round(
                                time.monotonic() - start_mono, 3
                            )

                    row["traffic"] = traffic(40 if cause else 35, observe)
                    new = [item for item in episodes() if item[0] not in previous]
                    row["incidents"] = len(new)
                    row["start_utc"] = datetime.fromtimestamp(
                        start_wall, timezone.utc
                    ).isoformat()
                    # Let the last scrape/Alloy batch arrive; keep the evidence window fixed.
                    end_wall = time.time()
                    time.sleep(3)
                    collection = asyncio.run(
                        collect(ports, reader, start_wall, end_wall)
                    )
                    row["source_statuses"] = {
                        item["source"]: item["status"]
                        for item in collection["evidence"]
                    }
                    row["analysis"] = collection["analysis"]
                    if new:
                        incident_id = str(new[0][0])
                        code, job = http(
                            ports["api"],
                            f"/api/v1/incidents/{incident_id}/investigations",
                            {},
                            {**auth, "idempotency-key": str(uuid4())},
                            method="POST",
                        )
                        assert code == 202
                        api.stdin.write(
                            (
                                json.dumps(
                                    {
                                        "investigation_id": job["id"],
                                        "collection": collection,
                                    }
                                )
                                + "\n"
                            ).encode()
                        )
                        api.stdin.flush()
                        marker = directory / (job["id"] + ".json")
                        wait(marker.is_file, 35)
                        row["report_saved"] = (
                            json.loads(marker.read_text(encoding="utf-8"))["status"]
                            == "SAVED"
                        )
                        if row["report_saved"]:
                            code, saved = http(
                                ports["api"],
                                f"/api/v1/investigations/{job['id']}/report",
                                headers=auth,
                            )
                            assert code == 200
                            row["saved_report"] = saved
                            assert saved["hash_verified"] is True
                            hypotheses = saved["report"]["hypotheses"]
                            row["top_category"] = (
                                hypotheses[0]["category"] if hypotheses else None
                            )
                    if cause:
                        mode("normal")
                        row["recovery_traffic"] = traffic(45)
                        states = {str(item[0]): item for item in episodes()}
                        row["recovered"] = (
                            bool(new)
                            and all(
                                states[str(item[0])][1:] == ("resolved", "OPEN")
                                for item in new
                            )
                            and set(row["recovery_traffic"]["responses"]) == {"201"}
                        )
                    report["summary"] = summarize(report["trials"])
                    (directory / "results.json").write_text(
                        json.dumps(report, indent=2), encoding="utf-8"
                    )
                    print(
                        json.dumps(
                            {
                                key: row[key]
                                for key in [
                                    "repetition",
                                    "scenario",
                                    "incidents",
                                    "detection_seconds",
                                    "report_saved",
                                    "top_category",
                                ]
                            }
                        ),
                        flush=True,
                    )
        report["status"] = "MEASURED"
    except BaseException as error:
        report.update(status="FAILED", error_type=type(error).__name__)
        raise
    finally:
        steps = [
            ("child", lambda child=child: stop(child)) for child in reversed(children)
        ]
        steps.extend(("log", log.close) for log in logs)
        if started:
            steps.append(
                (
                    "collectors",
                    lambda: subprocess.run(
                        command + ["down"], cwd=ROOT, check=True, timeout=90
                    ),
                )
            )
        if created:

            def drop_owned_database():
                with psycopg.connect(
                    owner, autocommit=True, connect_timeout=3
                ) as admin:
                    admin.execute(
                        sql.SQL("DROP DATABASE {}").format(sql.Identifier(name))
                    )

            steps.append(("test_database", drop_owned_database))
        steps.append(
            ("generated_token", lambda: (directory / "token").unlink(missing_ok=True))
        )
        failed = cleanup_owned(steps)
        report["owned_resources_cleaned"] = not failed
        if failed:
            report.update(status="FAILED", cleanup_failures=failed)
        report["summary"] = summarize(report["trials"])
        (directory / "results.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        (ROOT / ".artifacts/p10-quality.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
        if failed:
            raise RuntimeError(
                "Owned quality cleanup failed; inspect safe report labels"
            )
    print(json.dumps(report["summary"], indent=2), flush=True)


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
