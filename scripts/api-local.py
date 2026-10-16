"""Prepare the separate P3 development database and run the loopback-only API."""

import argparse
import os
import secrets
import shutil
import socket
import subprocess
from urllib.parse import urlsplit

from local_support import ROOT, docker_executable


def command(args, env=None, timeout=120):
    subprocess.run(args, cwd=ROOT, env=env, check=True, timeout=timeout)


def compose(env, project="sentinel-api", env_file=None):
    args = [docker_executable(), "compose"]
    if env_file:
        args += ["--env-file", str(env_file)]
    return args + ["-f", str(ROOT / "infrastructure/compose.api.yaml"), "-p", project]


def local_environment(path):
    env = dict(os.environ)
    for line in path.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            name, value = line.split("=", 1)
            if name in {
                "SENTINEL_POSTGRES_PASSWORD",
                "SENTINEL_DATABASE_URL",
                "SENTINEL_DATABASE_TLS",
                "SENTINEL_API_PORT",
                "SENTINEL_DB_PORT",
            }:
                # This dedicated file owns local demo settings, not hosted variables.
                env[name] = value
    url = urlsplit(env.get("SENTINEL_DATABASE_URL", ""))
    if (
        url.hostname != "127.0.0.1"
        or url.path != "/sentinel_api"
        or env.get("SENTINEL_DATABASE_TLS") != "disable"
    ):
        raise ValueError("Local helper requires its dedicated loopback database")
    env["SENTINEL_DB_NAME"] = "sentinel_api"
    return env


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    path = ROOT / ".env.api"
    if not path.exists():
        password = secrets.token_hex(24)
        with path.open("x", encoding="utf-8") as handle:
            handle.write(
                f"SENTINEL_POSTGRES_PASSWORD={password}\nSENTINEL_DATABASE_URL=postgresql://sentinel_api:{password}@127.0.0.1:55434/sentinel_api\nSENTINEL_DATABASE_TLS=disable\nSENTINEL_API_PORT=3000\nSENTINEL_DB_PORT=55434\n"
            )
        print("Created ignored .env.api; credentials omitted", flush=True)
    env = local_environment(path)
    # Resolve first so an unavailable Docker installation cannot leave child services.
    docker = compose(env, env_file=path)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", int(env["SENTINEL_API_PORT"])))
    command(docker + ["up", "-d", "--wait", "--wait-timeout", "60", "api-db"], env, 300)
    node = shutil.which("node")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not node or not npm:
        raise RuntimeError("Node and npm are required")
    command([npm, "run", "build", "--workspace=@sentinel/api"], env)
    command([node, "apps/api/dist/src/migrate.js"], env)
    command([node, "apps/api/dist/src/seed.js"], env)
    print(
        "Local API database ready; volume retained. Stop database using the documented Compose command.",
        flush=True,
    )
    if not args.prepare_only:
        child = subprocess.Popen(
            [node, "apps/api/dist/src/server.js"], cwd=ROOT, env=env
        )
        try:
            code = child.wait()
            if code:
                raise RuntimeError("API exited unsuccessfully")
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait(timeout=10)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("API stopped; database volume preserved")
    except Exception:
        raise SystemExit(
            "Local API setup/start failed; inspect safe command output and documented debugging steps (configuration values omitted)"
        ) from None
