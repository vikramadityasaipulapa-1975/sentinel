"""Real approved sandbox rollback verification with an owned disposable API DB."""

import importlib.util
import os
import shutil
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from local_support import ROOT
from psycopg import sql


def main():
    spec = importlib.util.spec_from_file_location(
        "sandbox_setup", ROOT / "scripts/sandbox-local.py"
    )
    setup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(setup)
    setup.prepare()
    values = setup.api_settings()
    url = urlsplit(values["SENTINEL_DATABASE_URL"])
    name = "sentinel_p8_verify_" + uuid4().hex[:12]
    dsn = urlunsplit(url._replace(path="/" + name))
    env = {
        **os.environ,
        "SENTINEL_DATABASE_URL": dsn,
        "SENTINEL_DATABASE_TLS": "disable",
        "TEST_P8_DATABASE_URL": dsn,
        "TEST_P8_PYTHON": sys.executable,
    }
    node = shutil.which("node")
    with psycopg.connect(values["SENTINEL_DATABASE_URL"], autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
        try:
            for script in ["migrate.js", "seed.js"]:
                subprocess.run(
                    [node, "apps/api/dist/src/" + script],
                    cwd=ROOT,
                    env=env,
                    check=True,
                    timeout=30,
                )
            result = subprocess.run(
                [node, "apps/api/dist/test/remediation-sandbox-scenario.js"],
                cwd=ROOT,
                env=env,
                check=False,
                capture_output=True,
                text=True,
                timeout=180,
            )
            if result.returncode:
                (ROOT / ".artifacts/p8-failure.log").write_text(
                    result.stderr, encoding="utf-8"
                )
                print(result.stderr[-2200:], flush=True)
                raise AssertionError("Sandbox HTTP/executor scenario failed")
            (ROOT / ".artifacts/p8-sandbox-verification.json").write_text(
                result.stdout, encoding="utf-8"
            )
            print(result.stdout, flush=True)
        finally:
            admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(name)))
    print(
        "P8 real sandbox verification passed; disposable API DB removed; sandbox retained; credentials omitted"
    )


if __name__ == "__main__":
    main()
