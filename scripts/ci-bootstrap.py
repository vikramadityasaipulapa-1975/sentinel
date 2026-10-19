"""Fresh Linux GitHub-runner integration environment; refuses developer state."""

import json
import os
import signal
import subprocess
import sys
import time

from local_support import ROOT, docker_executable, source_identity
from observability_support import checkout
from demo_support import CONFIGS, DemoStack, collector_command, preflight, prepare


def run(args, timeout=600):
    subprocess.run(args, cwd=ROOT, check=True, timeout=timeout)


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
    projects = []
    preflight()
    obs = collector_command()
    try:
        projects.extend([
            [docker, "compose", "--env-file", ".env.knowledge", "-f", "infrastructure/compose.knowledge.yaml"],
            [docker, "compose", "--env-file", ".env", "-f", "infrastructure/compose.yaml"],
            [docker, "compose", "--env-file", ".env.api", "-f", "infrastructure/compose.api.yaml"],
        ])
        prepare()
        checksum, commit = source_identity()
        for version in ["payment-v1", "payment-v3-error"]:
            run([docker, "build", "-f", "services/payment-service/Dockerfile", "--build-arg", f"PAYMENT_VERSION={version}", "--build-arg", f"SOURCE_SHA256={checksum}", "--build-arg", f"GIT_COMMIT={commit or 'unknown'}", "-t", f"sentinel-payment:{version}", "."], timeout=900)
        run([docker, "build", "-f", "services/checkout-service/Dockerfile", "-t", "sentinel-checkout:local-p2", "."], timeout=900)
        before = {name: (ROOT / name).read_bytes() for name in CONFIGS}
        projects.append(obs)
        with DemoStack() as stack:
            children = list(stack.children) + list(stack.demo.children.values())
            for _ in range(5):
                if checkout()[0] != 201:
                    raise RuntimeError("CI simulated checkout baseline failed")
            time.sleep(5)
            run([sys.executable, "scripts/check.py", "integration"], timeout=1500)
        if any(child.poll() is None for child in children):
            raise RuntimeError("Owned native process survived shared lifecycle cleanup")
        if any((ROOT / name).read_bytes() != content for name, content in before.items()):
            raise RuntimeError("Runtime changed existing configuration")
        # Repeat preparation must preserve every existing configuration byte.
        prepare()
        if any((ROOT / name).read_bytes() != content for name, content in before.items()):
            raise RuntimeError("Repeated preparation changed existing configuration")
        (ROOT / ".artifacts/p10-demo-verification.json").write_text(json.dumps({
            "shared_lifecycle": "PASSED", "owned_native_processes_stopped": True,
            "runtime_configuration_preserved": True, "repeat_preparation_preserved": True, "integration": "PASSED",
        }), encoding="utf-8")
    finally:
        sandbox = [docker, "compose", "-p", "sentinel-remediation-sandbox", "--env-file", ".env.sandbox", "-f", "infrastructure/compose.sandbox.yaml"]
        if (ROOT / ".env.sandbox").is_file():
            projects.append(sandbox)
        cleanup_errors = []
        for command in reversed(projects):
            # CI-only known projects; never -v, prune or unrelated container removal.
            if "--env-file" in command and not (ROOT / command[command.index("--env-file") + 1]).exists():
                continue
            try:
                subprocess.run(command + ["down"], cwd=ROOT, check=True, timeout=60)
            except (OSError, subprocess.SubprocessError):
                cleanup_errors.append("owned Compose cleanup failed")
        if cleanup_errors:
            raise RuntimeError("Some owned CI projects need cleanup; volumes retained")
        print(json.dumps({"ci_owned_processes_stopped": True, "ci_project_cleanup": True}))


if __name__ == "__main__":
    main()
