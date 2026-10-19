"""Fresh Linux GitHub-runner integration environment; refuses developer state."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request

from local_support import ROOT, docker_executable, source_identity
from observability_support import Demo, checkout


def run(args, timeout=600):
    subprocess.run(args, cwd=ROOT, check=True, timeout=timeout)


def ready(port, path, child=None):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if child and child.poll() is not None:
            raise RuntimeError("Owned CI service exited; inspect CI-local log")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.5)
    raise TimeoutError(f"CI service on {port} did not become ready")


def main():
    if sys.platform != "linux" or os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("Bootstrap is restricted to a fresh Linux GitHub runner")
    for name in [".env", ".env.api", ".env.evidence", ".env.knowledge", ".env.sandbox"]:
        if (ROOT / name).exists():
            raise RuntimeError("Existing local configuration found; refusing to overwrite")
    docker = docker_executable()
    names = subprocess.run([docker, "ps", "-a", "--format", "{{.Names}}"], cwd=ROOT, text=True, capture_output=True, check=True, timeout=10).stdout.splitlines()
    if any(name.startswith("sentinel-") for name in names):
        raise RuntimeError("Existing Sentinel containers found; refusing developer state")
    def cancelled(*_):
        raise KeyboardInterrupt("CI cancellation")
    signal.signal(signal.SIGTERM, cancelled)
    directory = ROOT / ".artifacts/ci"
    directory.mkdir(parents=True, exist_ok=True)
    api = None
    projects = []
    obs = [docker, "compose", "-f", "infrastructure/compose.observability.yaml", "-f", "infrastructure/ci/compose.observability.yaml"]
    try:
        run([sys.executable, "scripts/init-local.py"])
        projects.append([docker, "compose", "--env-file", ".env.knowledge", "-f", "infrastructure/compose.knowledge.yaml"])
        run([sys.executable, "scripts/knowledge-local.py"], timeout=900)
        projects.extend([
            [docker, "compose", "--env-file", ".env", "-f", "infrastructure/compose.yaml"],
            [docker, "compose", "--env-file", ".env.api", "-f", "infrastructure/compose.api.yaml"],
        ])
        run([sys.executable, "scripts/api-local.py", "--prepare-only"], timeout=600)
        run(["npm", "run", "build"])
        checksum, commit = source_identity()
        for version in ["payment-v1", "payment-v3-error"]:
            run([docker, "build", "-f", "services/payment-service/Dockerfile", "--build-arg", f"PAYMENT_VERSION={version}", "--build-arg", f"SOURCE_SHA256={checksum}", "--build-arg", f"GIT_COMMIT={commit or 'unknown'}", "-t", f"sentinel-payment:{version}", "."], timeout=900)
        run([docker, "build", "-f", "services/checkout-service/Dockerfile", "-t", "sentinel-checkout:local-p2", "."], timeout=900)
        with (directory / "api.log").open("w", encoding="utf-8") as log:
            api = subprocess.Popen([sys.executable, "scripts/api-local.py"], cwd=ROOT, stdout=log, stderr=log, start_new_session=True)
            ready(3000, "/ready", api)
            with Demo():
                projects.append(obs)
                run(obs + ["up", "-d", "prometheus", "loki", "alloy", "tempo"])
                ready(9090, "/-/ready")
                ready(3100, "/ready")
                for _ in range(5):
                    if checkout()[0] != 201:
                        raise RuntimeError("CI simulated checkout baseline failed")
                time.sleep(5)
                run([sys.executable, "scripts/check.py", "integration"], timeout=1500)
    finally:
        if api and api.poll() is None:
            # Only the process group created above; never broad process matching.
            if os.getpgid(api.pid) != api.pid:
                raise RuntimeError("Owned CI process group changed")
            os.killpg(api.pid, signal.SIGTERM)
            try:
                api.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(api.pid, signal.SIGKILL)
                api.wait(timeout=5)
        sandbox = [docker, "compose", "-p", "sentinel-remediation-sandbox", "--env-file", ".env.sandbox", "-f", "infrastructure/compose.sandbox.yaml"]
        if (ROOT / ".env.sandbox").is_file():
            projects.append(sandbox)
        for command in reversed(projects):
            # CI-only known projects; never -v, prune or unrelated container removal.
            subprocess.run(command + ["down"], cwd=ROOT, check=True, timeout=60)
        print(json.dumps({"ci_owned_processes_stopped": True, "ci_project_cleanup": True}))


if __name__ == "__main__":
    main()
