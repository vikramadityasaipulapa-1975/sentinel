"""Portable entry point: python scripts/demo.py start; Ctrl+C retains all data."""

import argparse
import importlib.util
import json
import os
import shutil
import signal
import sys
import time

from demo_support import CONFIGS, DemoStack, command, doctor, preflight, prepare
from local_support import ROOT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "doctor"])
    parser.add_argument("--skip-install", action="store_true", help="Use already installed locked dependencies")
    args = parser.parse_args()
    if args.action == "doctor":
        report = doctor()
        print(json.dumps(report, indent=2))
        return 0 if report["core"] == "READY" and report["knowledge"] == "READY" else 1
    preflight()
    if not args.skip_install:
        if sys.prefix == sys.base_prefix:
            raise RuntimeError("Create/activate .venv first; see docs/P10-DEMO.md. No packages installed globally")
        command([sys.executable, "-m", "pip", "install", "-r", "services/payment-service/requirements.txt", "-r", "apps/ai-engine/requirements.txt"], timeout=900)
        command([shutil.which("npm.cmd" if os.name == "nt" else "npm"), "ci"], timeout=900)
    if not (ROOT / "node_modules/.package-lock.json").is_file() or any(
        importlib.util.find_spec(name) is None for name in ("psycopg", "httpx", "uvicorn", "fastembed")
    ):
        raise RuntimeError("Locked dependencies missing; run start without --skip-install in .venv")
    prepare()
    before = {name: (ROOT / name).read_bytes() for name in CONFIGS}
    def cancelled(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, cancelled)
    try:
        with DemoStack() as stack:
            print("Core started: http://localhost:3000/dashboard/ (no default account).", flush=True)
            print(json.dumps(doctor(), indent=2), flush=True)
            print("Foreground supervision active; Ctrl+C stops owned native children. Containers/data retained.", flush=True)
            while True:
                stack.check()
                time.sleep(1)
    finally:
        if any((ROOT / name).read_bytes() != content for name, content in before.items()):
            raise RuntimeError("Configuration changed during runtime; inspect locally (values omitted)")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Demo stopped; existing configuration, dependency containers and volumes retained")
    except Exception as error:
        # Helper errors never include URLs/passwords; dependency exceptions may, so omit them.
        message = str(error) if type(error) is RuntimeError else type(error).__name__
        raise SystemExit(f"Demo failed: {message}. Check docs/P10-DEMO.md and ignored local logs.") from None
