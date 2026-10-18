"""Explicit setup for the approved disposable rollback sandbox; never the demo stack."""

import json
import subprocess

from local_support import ROOT, docker_executable
from sandbox_support import (
    CONFIG,
    PROJECT,
    Docker,
    assert_container,
    compose_hash,
    probe,
    wait_version,
    write_images,
)


def api_settings():
    values = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.api").read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#")
    )
    from urllib.parse import urlsplit

    url = urlsplit(values["SENTINEL_DATABASE_URL"])
    if url.hostname != "127.0.0.1" or url.path != "/sentinel_api" or url.query:
        raise ValueError("Local sandbox helper requires local Sentinel API DB")
    return values


def _prepare():
    import psycopg
    from psycopg.types.json import Jsonb

    values = api_settings()
    with psycopg.connect(values["SENTINEL_DATABASE_URL"]) as conn:
        if conn.execute(
            "SELECT count(*) FROM sentinel_api.remediation_actions WHERE status IN ('PENDING','APPROVED','EXECUTING')"
        ).fetchone()[0]:
            raise ValueError(
                "A proposal is active; finish/reject it before preparing sandbox"
            )
        conn.execute(
            "DELETE FROM sentinel_api.sandbox_binding WHERE project=%s", (PROJECT,)
        )
    context = subprocess.run(
        [docker_executable(), "context", "show"],
        capture_output=True,
        text=True,
        check=True,
        timeout=5,
    ).stdout.strip()
    docker = Docker(context)
    images = {}
    for tag in [
        "sentinel-payment:payment-v1",
        "sentinel-payment:payment-v3-error",
        "sentinel-checkout:local-p2",
    ]:
        row = docker.json("image", "inspect", tag)[0]
        images[tag] = row["Id"]
        if tag.startswith("sentinel-payment"):
            labels = row["Config"].get("Labels", {})
            if (
                labels.get("sentinel.version") != tag.split(":")[1]
                or row["Config"].get("User") != "10001:10001"
            ):
                raise ValueError("Unrecognized demo payment image")
    good = images["sentinel-payment:payment-v1"]
    bad = images["sentinel-payment:payment-v3-error"]
    checkout = images["sentinel-checkout:local-p2"]
    if good == bad:
        raise ValueError("Fault and good images must differ")
    write_images(good, checkout)
    docker.compose("up", "-d", "--no-build", "--pull", "never", "payment", "checkout")
    wait_version("payment-v1")
    baseline = probe("payment-v1")
    if (
        baseline["successful_checkouts"] != 3
        or not baseline["ready"]
        or not baseline["version_matches"]
    ):
        raise ValueError("Known-good baseline failed")
    write_images(bad, checkout)
    docker.compose("up", "-d", "--no-build", "--pull", "never", "--no-deps", "payment")
    wait_version("payment-v3-error")
    fault = probe("payment-v3-error", 1)
    if fault["successful_checkouts"] != 0:
        raise ValueError("Expected sandbox fault was not observed")
    current = docker.payment()
    assert_container(current, bad)
    binding = {
        "project": PROJECT,
        "container_id": current["Id"],
        "current_image": bad,
        "current_version": "payment-v3-error",
        "target_image": good,
        "target_version": "payment-v1",
    }
    CONFIG.parent.mkdir(exist_ok=True)
    CONFIG.write_text(
        json.dumps(
            {
                "context": context,
                "binding": binding,
                "checkout_image": checkout,
                "compose_sha256": compose_hash(),
                "baseline": baseline,
                "fault": fault,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    with psycopg.connect(values["SENTINEL_DATABASE_URL"]) as conn:
        conn.execute(
            "INSERT INTO sentinel_api.sandbox_binding(project,binding_json) VALUES (%s,%s) ON CONFLICT(project) DO UPDATE SET binding_json=excluded.binding_json,registered_at=statement_timestamp()",
            (PROJECT, Jsonb(binding)),
        )
    print(
        "Isolated sandbox prepared: verified good baseline, observed simulated error, immutable binding registered; no demo DB used"
    )


def prepare():
    from filelock import FileLock

    with FileLock(str(ROOT / ".artifacts/p8-executor.lock"), timeout=0):
        _prepare()


if __name__ == "__main__":
    try:
        prepare()
    except Exception:
        raise SystemExit(
            "Sandbox preparation failed; check Docker/images/migrations/active proposals (credentials omitted)"
        ) from None
