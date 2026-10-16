"""Allowlisted local Compose version switch. Default is a read-only plan."""

import argparse
import json
import re
import subprocess
import sys
import time

from deployment_registry import (
    begin_deployment,
    finish_deployment,
    known_version,
    register_version,
)
from local_support import (
    ROOT,
    compose_command,
    docker_executable,
    http,
    local_env,
    source_identity,
)

sys.path.insert(0, str(ROOT / "services/payment-service"))
from config import VERSIONS


def inspect_image(tag):
    result = subprocess.run(
        [docker_executable(), "image", "inspect", tag],
        capture_output=True,
        text=True,
        timeout=15,
    )
    return json.loads(result.stdout)[0] if result.returncode == 0 else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("version", choices=sorted(VERSIONS))
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually switch the local payment container",
    )
    parser.add_argument(
        "--allow-working-tree",
        action="store_true",
        help="Record exact content hash with unknown commit for uncommitted local code",
    )
    parser.add_argument(
        "--project",
        default="sentinel-demo",
        help="Only sentinel-demo or a verifier-owned project",
    )
    args = parser.parse_args()
    if not re.fullmatch(r"sentinel-demo|sentinel-p2-verify-[0-9a-f]{8}", args.project):
        raise ValueError("Unknown local Compose project")
    if not args.apply:
        print(
            json.dumps(
                {
                    "service": "payment-service",
                    "version": args.version,
                    "profile": VERSIONS[args.version],
                    "effect": "recreate only the local payment container; retain database volume",
                    "applied": False,
                },
                indent=2,
            )
        )
        return
    env = local_env()
    dsn = env.get("DATABASE_URL")
    if not dsn:
        raise RuntimeError("Run scripts/init-local.py first")
    command = compose_command(args.project)
    source_sha, commit_sha = source_identity()
    registered = known_version(dsn, args.version)
    tag = f"sentinel-payment:{args.version}"
    image = inspect_image(
        registered["image_id"] if registered and registered["image_id"] else tag
    )
    if registered and image:
        labels = image["Config"].get("Labels") or {}
        if (
            registered["source_sha256"] != labels.get("sentinel.source-sha256")
            or registered["image_id"] != image["Id"]
        ):
            raise ValueError("Cached image does not match the immutable registry")
        source_sha, commit_sha = registered["source_sha256"], registered["commit_sha"]
        subprocess.run(
            [docker_executable(), "image", "tag", image["Id"], tag],
            check=True,
            timeout=15,
        )
    else:
        if registered and registered["source_sha256"] != source_sha:
            raise ValueError(
                "Original version image/source unavailable; cannot rebuild a different version under the old name"
            )
        if not commit_sha and not args.allow_working_tree:
            raise ValueError(
                "Commit reviewed source first, or explicitly use --allow-working-tree for this local demo"
            )
        env.update(
            PAYMENT_VERSION=args.version,
            SOURCE_SHA256=source_sha,
            GIT_COMMIT=commit_sha or "unknown",
        )
        subprocess.run(
            command + ["build", "payment"], cwd=ROOT, env=env, check=True, timeout=600
        )
        image = inspect_image(tag)
        if not image:
            raise RuntimeError("Built image is unavailable")
    labels = image["Config"].get("Labels") or {}
    if (
        labels.get("sentinel.version") != args.version
        or labels.get("sentinel.source-sha256") != source_sha
        or labels.get("sentinel.commit") != (commit_sha or "unknown")
    ):
        raise ValueError("Built image metadata does not match the selected version")
    register_version(dsn, args.version, source_sha, commit_sha, image["Id"])
    deployment_id = begin_deployment(dsn, args.version, "compose")
    env.update(
        PAYMENT_VERSION=args.version,
        SOURCE_SHA256=source_sha,
        GIT_COMMIT=commit_sha or "unknown",
        DEPLOYMENT_ID=deployment_id,
    )
    try:
        subprocess.run(
            command + ["up", "-d", "--no-deps", "--no-build", "payment"],
            cwd=ROOT,
            env=env,
            check=True,
            timeout=60,
        )
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            try:
                status, identity = http(3002, "/version")
                if (
                    status == 200
                    and identity.get("deployment_id") == deployment_id
                    and http(3002, "/ready")[0] == 200
                ):
                    finish_deployment(dsn, deployment_id, identity)
                    break
            except OSError:
                pass
            time.sleep(0.25)
        else:
            raise TimeoutError("New local payment version was not verified")
    except Exception:
        finish_deployment(dsn, deployment_id)
        raise
    # Persist only safe deployment selectors; retain all existing credentials/settings.
    path = ROOT / ".env"
    lines = path.read_text(encoding="utf-8").splitlines()
    updates = {
        name: env[name]
        for name in ("PAYMENT_VERSION", "SOURCE_SHA256", "GIT_COMMIT", "DEPLOYMENT_ID")
    }
    lines = [line for line in lines if line.split("=", 1)[0] not in updates]
    if args.project == "sentinel-demo":
        temporary = path.with_name(".env.next")
        temporary.write_text(
            "\n".join(lines + [f"{key}={value}" for key, value in updates.items()])
            + "\n",
            encoding="utf-8",
        )
        temporary.replace(path)
    print(
        json.dumps(
            {
                "deployment_id": deployment_id,
                "version": args.version,
                "status": "ACTIVE",
                "source_sha256": source_sha,
                "commit_sha": commit_sha,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(
            "Local version switch failed; no success claimed. Inspect readiness/registry and retained local images; credentials omitted."
        ) from None
