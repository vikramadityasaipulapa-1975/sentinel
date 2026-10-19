"""Isolated browser checks; no main accounts, queue, Docker actions or cloud."""

import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4
import urllib.request

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parent.parent


def settings(path):
    return dict(
        line.split("=", 1)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
    )


def main():
    values = settings(ROOT / ".env.api")
    owner = values["SENTINEL_DATABASE_URL"]
    parsed = urlsplit(owner)
    if parsed.hostname != "127.0.0.1" or parsed.path != "/sentinel_api":
        raise ValueError("Dedicated local Sentinel database required")
    name = "sentinel_p9_verify_" + uuid4().hex[:12]
    dsn = urlunsplit(parsed._replace(path="/" + name))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    directory = ROOT / ".artifacts" / name
    directory.mkdir(parents=True)
    metadata = directory / "fixture.json"
    env = {
        **os.environ,
        **settings(ROOT / ".env.evidence"),
        "SENTINEL_DATABASE_URL": dsn,
        "SENTINEL_EVIDENCE_URL": "http://127.0.0.1:8001",
        "SENTINEL_DATABASE_TLS": "disable",
        "SENTINEL_API_PORT": str(port),
        "SENTINEL_JWT_SECRET": secrets.token_hex(32),
        "SENTINEL_WEB_TEST_PASSWORD": secrets.token_urlsafe(24),
        "SENTINEL_WEB_TEST_FIXTURE": str(metadata),
        "SENTINEL_WEB_TEST_URL": f"http://127.0.0.1:{port}",
    }
    env.pop("SENTINEL_DATABASE_CA", None)
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    node = shutil.which("node")
    if not npm or not node:
        raise RuntimeError("Node/npm required")
    child = None
    report = {
        "status": "RUNNING",
        "scope": "isolated API DB; real HTTP/browser/engine reads; "
        "synthetic sandbox binding; no Docker executor",
        "directory": directory.name,
    }
    with psycopg.connect(owner, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        try:
            with (directory / "backend.log").open("w", encoding="utf-8") as log:
                child = subprocess.Popen(
                    [node, "apps/api/dist/test/dashboard-fixture.js"],
                    cwd=ROOT,
                    env=env,
                    stdout=log,
                    stderr=log,
                )
                deadline = time.monotonic() + 75
                while not metadata.exists():
                    if child.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError(
                            "Browser backend not ready; inspect ignored backend.log"
                        )
                    time.sleep(0.25)
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/ready", timeout=5
                ) as response:
                    assert response.status == 200
                subprocess.run(
                    [npm, "run", "test:web:browser"],
                    cwd=ROOT,
                    env=env,
                    check=True,
                    timeout=600,
                )
                report["status"] = "PASSED"
        except Exception as error:
            report["status"] = "FAILED"
            report["error_type"] = type(error).__name__
            raise
        finally:
            if child and child.poll() is None:
                child.terminate()
                child.wait(timeout=15)
            admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(name)))
            report["test_database_removed"] = True
            (ROOT / ".artifacts/p9-browser-verification.json").write_text(
                json.dumps(report, indent=2), encoding="utf-8"
            )
    print(
        "P9 isolated browser verification passed; test DB removed; "
        "learner records unchanged"
    )


if __name__ == "__main__":
    main()
