"""Real PostgreSQL persistence/concurrency and local runtime version verification."""

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import uuid4

import psycopg
from deployment_registry import (
    begin_deployment,
    finish_deployment,
    register_version,
)
from local_support import (
    ROOT,
    DockerUnavailable,
    compose_command,
    docker_executable,
    http,
    local_env,
    source_identity,
)
from migrate import migrate

sys.path.insert(0, str(ROOT / "services/payment-service"))
from models import PaymentRequest
from store import PaymentConflict, PostgresStore

ARTIFACTS = ROOT / ".artifacts"
FLAGS = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


def run(command, **kwargs):
    return subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        timeout=kwargs.pop("timeout", 60),
        **FLAGS,
        **kwargs,
    )


def await_ready(port, child=None):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if child and child.poll() is not None:
            raise RuntimeError("Service exited; inspect its artifact log")
        try:
            if http(port, "/ready" if port == 3002 else "/health")[0] == 200:
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise TimeoutError("Service readiness timed out")


def stop(child):
    if child and child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)


@contextmanager
def native_database(directory):
    binary = ROOT / ".tools/postgres/pgsql/bin"
    if not (binary / "initdb.exe").is_file():
        raise RuntimeError("Run scripts/setup-postgres.ps1 before native verification")
    data = directory / "data"
    if not data.resolve().is_relative_to(ARTIFACTS.resolve()) or data.exists():
        raise RuntimeError("Test database path must be a new artifact directory")
    password = secrets.token_hex(24)
    pwfile = directory / "init-password"
    pwfile.write_text(password, encoding="utf-8")
    try:
        with (directory / "init.log").open("w") as log:
            run(
                [
                    str(binary / "initdb.exe"),
                    "-D",
                    str(data),
                    "-U",
                    "sentinel",
                    "--pwfile",
                    str(pwfile),
                    "--auth=scram-sha-256",
                    "--encoding=UTF8",
                    "--locale=C",
                ],
                stdout=log,
                stderr=log,
            )
    finally:
        pwfile.unlink(missing_ok=True)  # Only the generated one-use secret file.
    started = False

    def control(arguments):
        # Windows server children can inherit pipe handles; use a file, not PIPE.
        with (directory / "control.log").open("a") as log:
            run(
                [str(binary / "pg_ctl.exe"), "-D", str(data)] + arguments,
                stdout=log,
                stderr=log,
            )

    def start():
        nonlocal started
        started = True
        control(
            [
                "-l",
                str(directory / "postgres.log"),
                "-o",
                "-h 127.0.0.1 -p 55433",
                "-w",
                "-t",
                "20",
                "start",
            ]
        )

    def restart():
        control(["-m", "fast", "-w", "restart"])

    try:
        start()
        dsn = f"postgresql://sentinel:{password}@127.0.0.1:55433/postgres"
        with psycopg.connect(dsn, autocommit=True, connect_timeout=3) as conn:
            conn.execute("CREATE DATABASE sentinel_p2")
        yield dsn.rsplit("/", 1)[0] + "/sentinel_p2", restart
    finally:
        if started and (data / "postmaster.pid").exists():
            control(["-m", "fast", "-w", "stop"])


def database_checks(dsn):
    assert migrate(dsn) == ["001_demo_payments.sql", "002_demo_deployments.sql"]
    assert migrate(dsn) == []
    # Compare an altered copy, never edit applied source or the migration ledger.
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory(prefix="sentinel-migration-check-") as temporary:
        fixture = Path(temporary)
        for path in (ROOT / "database/migrations").glob("*.sql"):
            shutil.copyfile(path, fixture / path.name)
        altered = fixture / "001_demo_payments.sql"
        altered.write_text(altered.read_text() + "\n-- changed fixture\n")
        try:
            migrate(dsn, fixture)
        except RuntimeError:
            pass
        else:
            raise AssertionError("Changed applied migration accepted")
    store = PostgresStore(dsn)
    assert store.ready()
    request = PaymentRequest(order_id=uuid4(), amount_minor=12500, currency="INR")
    key = uuid4()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: store.save(request, key), range(16)))
    assert len({item.payment_id for item in results}) == 1
    with psycopg.connect(dsn) as conn:
        assert (
            conn.execute(
                "SELECT count(*) FROM demo_payments WHERE order_id=%s",
                (request.order_id,),
            ).fetchone()[0]
            == 1
        )
        try:
            with conn.transaction():
                conn.execute(
                    "INSERT INTO demo_orders (id,amount_minor,currency) VALUES (%s,0,'INR')",
                    (uuid4(),),
                )
        except psycopg.errors.CheckViolation:
            pass
        else:
            raise AssertionError("Amount constraint was not enforced")
        try:
            with conn.transaction():
                conn.execute(
                    "INSERT INTO demo_payments (id,order_id,idempotency_key,status) VALUES (%s,%s,%s,'succeeded')",
                    (uuid4(), uuid4(), uuid4()),
                )
        except psycopg.errors.ForeignKeyViolation:
            pass
        else:
            raise AssertionError("Foreign key was not enforced")
        orphan = uuid4()
        try:
            with conn.transaction():
                conn.execute(
                    "INSERT INTO demo_orders (id,amount_minor,currency) VALUES (%s,1,'INR')",
                    (orphan,),
                )
                raise RuntimeError("Deliberate transaction rollback")
        except RuntimeError:
            pass
        assert (
            conn.execute(
                "SELECT count(*) FROM demo_orders WHERE id=%s", (orphan,)
            ).fetchone()[0]
            == 0
        )
    for changed in [
        request.model_copy(update={"amount_minor": 1}),
        PaymentRequest(order_id=uuid4(), amount_minor=1, currency="INR"),
    ]:
        try:
            store.save(changed, key)
        except PaymentConflict:
            pass
        else:
            raise AssertionError("Conflicting key accepted")
    return (
        {
            "concurrent_requests": 16,
            "payments_created": 1,
            "constraint_and_rollback_checks": True,
            "migration_replay_and_checksum_guard": True,
        },
        request,
        key,
        results[0],
    )


def request_body():
    return {"order_id": str(uuid4()), "amount_minor": 12500, "currency": "INR"}


def http_checks():
    body, key = request_body(), str(uuid4())
    first = http(3001, "/checkout", body, key)
    assert first[0] == 201, first[0]
    with ThreadPoolExecutor(max_workers=8) as pool:
        replays = list(pool.map(lambda _: http(3001, "/checkout", body, key), range(8)))
    assert all(status == 201 and result == first[1] for status, result in replays)
    assert http(3001, "/checkout", {**body, "amount_minor": 1}, key)[0] == 409
    assert http(3001, "/checkout", body, str(uuid4()))[0] == 409
    return body, key, first[1]


def native_runtime_checks(dsn, restart, directory, report):
    env = {
        **os.environ,
        "STORAGE_MODE": "postgres",
        "DATABASE_URL": dsn,
        "PAYMENT_URL": "http://127.0.0.1:3002",
        "PAYMENT_TIMEOUT_MS": "1000",
        "PAYMENT_MAX_ATTEMPTS": "2",
    }
    checksum, commit = source_identity()
    child = None
    checkout = None
    logs = []

    def launch(version):
        nonlocal child
        stop(child)
        register_version(dsn, version, checksum, commit)
        deployment_id = begin_deployment(dsn, version, "native")
        log = (directory / f"{deployment_id}.log").open("w", encoding="utf-8")
        logs.append(log)
        child = subprocess.Popen(
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
            env={
                **env,
                "PAYMENT_VERSION": version,
                "SOURCE_SHA256": checksum,
                "GIT_COMMIT": commit or "unknown",
                "DEPLOYMENT_ID": deployment_id,
            },
            stdout=log,
            stderr=log,
            **FLAGS,
        )
        try:
            await_ready(3002, child)
            identity = http(3002, "/version")[1]
            finish_deployment(dsn, deployment_id, identity)
            return identity
        except Exception:
            finish_deployment(dsn, deployment_id)
            raise

    try:
        identity = launch("payment-v1")
        report["runtime_source"] = {
            name: identity[name] for name in ("source_sha256", "commit_sha")
        }
        log = (directory / "checkout.log").open("w", encoding="utf-8")
        logs.append(log)
        checkout = subprocess.Popen(
            ["node", "services/checkout-service/dist/src/server.js"],
            cwd=ROOT,
            env=env,
            stdout=log,
            stderr=log,
            **FLAGS,
        )
        await_ready(3001, checkout)
        body, key, original = http_checks()
        launch("payment-v1")
        restart()
        await_ready(3002, child)
        assert http(3001, "/checkout", body, key) == (201, original)
        report["restart_persistence"] = True
        report["http_concurrent_replays"] = 8
        report["versions"] = [identity["version"]]
        for version, expected in [
            ("payment-v2-timeout", 504),
            ("payment-v3-error", 502),
            ("payment-v1", 201),
        ]:
            identity = launch(version)
            status, _ = http(3001, "/checkout", request_body(), str(uuid4()))
            assert status == expected, (version, status)
            report["versions"].append(identity["version"])
        # An uncertain caller outcome: 50 ms client wait, 180 ms pre-commit delay.
        stop(child)
        log = (directory / "uncertain-payment.log").open("w", encoding="utf-8")
        logs.append(log)
        child = subprocess.Popen(
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
            env={
                **env,
                "PAYMENT_VERSION": "unversioned",
                "PAYMENT_FAULT_MODE": "latency",
                "PAYMENT_FAULT_DELAY_MS": "180",
                "DEPLOYMENT_ID": "unregistered",
            },
            stdout=log,
            stderr=log,
            **FLAGS,
        )
        await_ready(3002, child)
        import urllib.error
        import urllib.request

        uncertain_body, uncertain_key = request_body(), str(uuid4())
        req = urllib.request.Request(
            "http://127.0.0.1:3002/payments",
            data=json.dumps(uncertain_body).encode(),
            headers={
                "content-type": "application/json",
                "idempotency-key": uncertain_key,
            },
        )
        try:
            urllib.request.urlopen(req, timeout=0.05)
        except (TimeoutError, urllib.error.URLError):
            pass
        else:
            raise AssertionError("Expected caller timeout")
        time.sleep(0.3)
        with psycopg.connect(dsn) as conn:
            first_id = conn.execute(
                "SELECT id FROM demo_payments WHERE idempotency_key=%s",
                (uncertain_key,),
            ).fetchone()[0]
        replay = http(3002, "/payments", uncertain_body, uncertain_key)
        assert replay[0] == 201 and replay[1]["payment_id"] == str(first_id)
        report["uncertain_outcome_replay"] = True
        launch("payment-v1")
        # Changed contents cannot reuse an immutable name; invalid verification cannot activate.
        try:
            register_version(dsn, "payment-v1", "0" * 64)
        except ValueError:
            pass
        else:
            raise AssertionError("Mutable version accepted")
        failed_id = begin_deployment(dsn, "payment-v3-error", "native")
        try:
            finish_deployment(dsn, failed_id, {"version": "wrong"})
        except ValueError:
            finish_deployment(dsn, failed_id)
        else:
            raise AssertionError("Unverified deployment activated")
        report["version_negative_checks"] = True
    finally:
        stop(checkout)
        stop(child)
        for log in logs:
            log.close()


def compose_checks(directory, report):
    project = "sentinel-p2-verify-" + directory.name.split("-")[-1]
    command = compose_command(project)
    try:
        engine = run(
            [docker_executable(), "info", "--format", "{{.OSType}}"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise DockerUnavailable("Docker Desktop engine is not ready") from None
    if engine.stdout.strip() != "linux":
        raise DockerUnavailable("Start Docker Desktop with Linux containers")
    run([sys.executable, "scripts/init-local.py"])
    env = local_env()
    checksum, commit = source_identity()
    env.update(
        PAYMENT_VERSION="payment-v1",
        SOURCE_SHA256=checksum,
        GIT_COMMIT=commit or "unknown",
        DEPLOYMENT_ID="unregistered",
    )
    dsn = env["DATABASE_URL"]
    report["compose_project"] = project
    run(command + ["config", "--quiet"], env=env)
    started = False
    try:
        started = True
        run(
            command + ["up", "-d", "--wait", "--wait-timeout", "60", "db"],
            env=env,
            timeout=600,
        )
        checks, request, key, original = database_checks(dsn)
        report["database"] = checks
        run(
            command + ["up", "-d", "--build", "--wait", "--wait-timeout", "90"],
            env=env,
            timeout=600,
        )
        await_ready(3001)
        await_ready(3002)
        body, http_key, first = http_checks()
        run(command + ["restart", "db", "payment"], env=env)
        await_ready(3002)
        assert PostgresStore(dsn).save(request, key) == original
        assert http(3001, "/checkout", body, http_key) == (201, first)
        report["restart_persistence"] = True
        report["http_concurrent_replays"] = 8
        report["versions"] = []
        for version, expected in [
            ("payment-v1", 201),
            ("payment-v2-timeout", 504),
            ("payment-v3-error", 502),
            ("payment-v1", 201),
        ]:
            run(
                [
                    sys.executable,
                    "scripts/switch-payment.py",
                    version,
                    "--apply",
                    "--allow-working-tree",
                    "--project",
                    project,
                ],
                env=env,
                timeout=600,
            )
            assert http(3002, "/version")[1]["version"] == version
            assert http(3001, "/checkout", request_body(), str(uuid4()))[0] == expected
            report["versions"].append(version)
        with psycopg.connect(dsn) as conn:
            report["deployment_records"] = conn.execute(
                "SELECT count(*) FROM demo_deployments"
            ).fetchone()[0]
            assert (
                conn.execute(
                    "SELECT count(*) FROM demo_deployments WHERE status='ACTIVE'"
                ).fetchone()[0]
                == 1
            )
        report["compose_verified"] = True
    finally:
        if started:
            # Test-owned project only; never -v, never delete its database volume.
            run(command + ["down"], env=env)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=["native", "compose"], default="native")
    args = parser.parse_args()
    ARTIFACTS.mkdir(exist_ok=True)
    directory = ARTIFACTS / f"p2-{uuid4().hex[:8]}"
    directory.mkdir()
    report = {
        "run_at": datetime.now(UTC).isoformat(),
        "status": "RUNNING",
        "backend": args.backend,
        "artifact_directory": directory.name,
    }
    report_path = ARTIFACTS / f"p2-{args.backend}-verification.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    try:
        for port in [3001, 3002] + ([55433] if args.backend == "native" else [55432]):
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        if args.backend == "compose":
            compose_checks(directory, report)
        else:
            with native_database(directory) as (dsn, restart):
                checks, request, key, original = database_checks(dsn)
                report["database"] = checks
                restart()
                assert PostgresStore(dsn).save(request, key) == original
                native_runtime_checks(dsn, restart, directory, report)
                with psycopg.connect(dsn) as conn:
                    report["deployment_records"] = conn.execute(
                        "SELECT count(*) FROM demo_deployments"
                    ).fetchone()[0]
                    assert (
                        conn.execute(
                            "SELECT count(*) FROM demo_deployments WHERE status='ACTIVE'"
                        ).fetchone()[0]
                        == 1
                    )
                    active = conn.execute(
                        "SELECT deployed_at, verified_at FROM demo_deployments WHERE status='ACTIVE'"
                    ).fetchone()
                    assert active[1] >= active[0]
                    report["last_verified_at"] = active[1].astimezone(UTC).isoformat()
            report["compose_verified"] = False
        report["status"] = "PASSED"
        print(
            f"PASS: P2 {args.backend} verification; see backend-specific artifact report"
        )
    except Exception as error:
        report.update(
            status="BLOCKED" if isinstance(error, DockerUnavailable) else "FAILED",
            error_type=type(error).__name__,
        )
        if isinstance(error, DockerUnavailable):
            report["reason"] = str(error)
        raise
    finally:
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
