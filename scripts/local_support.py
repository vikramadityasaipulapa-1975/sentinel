"""Local demo CLI helpers. Never print configuration values or execute shell text."""

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
KEYS = {
    "DATABASE_URL",
    "POSTGRES_PASSWORD",
    "STORAGE_MODE",
    "PAYMENT_VERSION",
    "PAYMENT_URL",
    "PAYMENT_TIMEOUT_MS",
    "PAYMENT_MAX_ATTEMPTS",
    "SOURCE_SHA256",
    "GIT_COMMIT",
    "DEPLOYMENT_ID",
}


class DockerUnavailable(RuntimeError):
    pass


def local_env():
    env = dict(os.environ)
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                if key in KEYS:
                    env.setdefault(key, value)
    return env


def docker_executable():
    found = shutil.which("docker")
    if found:
        return found
    for base in [
        Path("C:/Program Files/Docker/Docker"),
        Path(os.environ.get("LOCALAPPDATA", ".")) / "Programs/DockerDesktop",
    ]:
        candidate = base / "resources/bin/docker.exe"
        if candidate.is_file():
            return str(candidate)
    raise DockerUnavailable(
        "Docker Desktop is not available; install/start it before Compose verification"
    )


def compose_command(project=None):
    command = [
        docker_executable(),
        "compose",
        "--env-file",
        str(ROOT / ".env"),
        "-f",
        str(ROOT / "infrastructure/compose.yaml"),
    ]
    if project:
        command += ["--project-name", project]
    return command


def source_identity():
    files = [
        path
        for path in (ROOT / "services/payment-service").glob("*.py")
        if not path.name.startswith("test_")
    ]
    files += [
        ROOT / "services/payment-service" / name
        for name in ("versions.json", "Dockerfile", "requirements.txt")
    ]
    files += list((ROOT / "database/migrations").glob("*.sql")) + [
        ROOT / "scripts/migrate.py"
    ]
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(path.relative_to(ROOT).as_posix().encode() + b"\0")
        digest.update(path.read_bytes().replace(b"\r\n", b"\n") + b"\0")
    dirty = bool(
        subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        ).stdout
    )
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
        timeout=5,
    ).stdout.strip()
    return digest.hexdigest(), None if dirty else commit


def http(port, path, body=None, key=None):
    headers = {}
    if key:
        headers["Idempotency-Key"] = key
    payload = json.dumps(body).encode() if body is not None else None
    if payload:
        headers["content-type"] = "application/json"
    request = Request(f"http://127.0.0.1:{port}{path}", data=payload, headers=headers)
    try:
        response = urlopen(request, timeout=10)
    except HTTPError as error:
        response = error
    with response:
        return response.status, json.loads(response.read(16385))
