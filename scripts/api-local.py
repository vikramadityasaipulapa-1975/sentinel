"""Prepare the separate P3 development database and run the loopback-only API."""

import argparse
import os
import secrets
import shutil
import socket
import subprocess
import time
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
                "SENTINEL_JWT_SECRET",
                "SENTINEL_REDIS_URL",
                "SENTINEL_REDIS_PASSWORD",
                "SENTINEL_REDIS_PORT",
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
    redis_url = urlsplit(env.get("SENTINEL_REDIS_URL", ""))
    if redis_url.hostname != "127.0.0.1" or redis_url.path != "/0":
        raise ValueError("Local helper requires dedicated loopback Redis")
    env["SENTINEL_DB_NAME"] = "sentinel_api"
    return env


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument(
        "--api-only",
        action="store_true",
        help="Run dispatcher/worker in a separate terminal",
    )
    args = parser.parse_args()
    path = ROOT / ".env.api"
    if not path.exists():
        password = secrets.token_hex(24)
        with path.open("x", encoding="utf-8") as handle:
            handle.write(
                f"SENTINEL_POSTGRES_PASSWORD={password}\nSENTINEL_DATABASE_URL=postgresql://sentinel_api:{password}@127.0.0.1:55434/sentinel_api\nSENTINEL_DATABASE_TLS=disable\nSENTINEL_API_PORT=3000\nSENTINEL_DB_PORT=55434\n"
            )
        print("Created ignored .env.api; credentials omitted", flush=True)
    if not any(
        line.startswith("SENTINEL_JWT_SECRET=")
        for line in path.read_text(encoding="utf-8").splitlines()
    ):
        with path.open("a", encoding="utf-8") as handle:
            handle.write(f"\nSENTINEL_JWT_SECRET={secrets.token_hex(32)}\n")
        print("Added local JWT secret to ignored .env.api; value omitted", flush=True)
    settings = dict(
        line.split("=", 1)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    redis_password = settings.get("SENTINEL_REDIS_PASSWORD", secrets.token_hex(24))
    redis_port = settings.get("SENTINEL_REDIS_PORT", "56379")
    defaults = {
        "SENTINEL_REDIS_PASSWORD": redis_password,
        "SENTINEL_REDIS_PORT": redis_port,
        "SENTINEL_REDIS_URL": f"redis://default:{redis_password}@127.0.0.1:{redis_port}/0",
    }
    with path.open("a", encoding="utf-8") as handle:
        for name, value in defaults.items():
            if name not in settings:
                handle.write(f"\n{name}={value}\n")
    env = local_environment(path)
    # Resolve first so an unavailable Docker installation cannot leave child services.
    docker = compose(env, env_file=path)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", int(env["SENTINEL_API_PORT"])))
    command(
        docker + ["up", "-d", "--wait", "--wait-timeout", "60", "api-db", "api-redis"],
        env,
        300,
    )
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
        children = []
        try:
            children.append(
                subprocess.Popen(
                    [node, "apps/api/dist/src/server.js"], cwd=ROOT, env=env
                )
            )
            if not args.api_only:
                worker_env = dict(env)
                worker_env.pop("SENTINEL_JWT_SECRET", None)
                children.append(
                    subprocess.Popen(
                        [node, "apps/api/dist/src/worker-main.js"],
                        cwd=ROOT,
                        env=worker_env,
                    )
                )
            while all(child.poll() is None for child in children):
                time.sleep(0.5)
            raise RuntimeError("A local service exited; inspect safe logs")
        finally:
            for child in children:
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
