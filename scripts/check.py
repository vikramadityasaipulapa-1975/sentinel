"""Portable, fail-fast test tiers. No credentials or environments are printed."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
VENV = ROOT / (".venv/Scripts/python.exe" if os.name == "nt" else ".venv/bin/python")
PYTHON = str(VENV) if VENV.is_file() else sys.executable
NPM = shutil.which("npm.cmd" if os.name == "nt" else "npm")
NODE = shutil.which("node")


def run(label, args, results, env=None, timeout=600):
    print(f"CHECK: {label}", flush=True)
    started = time.monotonic()
    subprocess.run(args, cwd=ROOT, env=env, check=True, timeout=timeout)
    results.append({"check": label, "status": "PASSED", "seconds": round(time.monotonic() - started, 2)})


def lint_probes():
    cases = [
        ([NODE, "node_modules/eslint/bin/eslint.js", "--stdin", "--stdin-filename", "apps/web/src/ci-probe.ts", "--format", "json"], "const probe = 1; probe = 2;\n", 1, "no-const-assign"),
        ([PYTHON, "-m", "ruff", "check", "--stdin-filename", "scripts/ci_probe.py", "-"], "print(undefined_ci_probe)\n", 1, "F821"),
        ([PYTHON, "-m", "ruff", "check", "--stdin-filename", "scripts/ci_probe.py", "-"], 'print("valid CI probe")\n', 0, "All checks passed"),
    ]
    for args, source, expected, marker in cases:
        result = subprocess.run(args, cwd=ROOT, input=source, text=True, capture_output=True, timeout=30)
        if result.returncode != expected or marker not in result.stdout:
            raise RuntimeError("Lint positive/negative control failed; no source file was changed")
    try:
        run("expected command failure control", [PYTHON, "-c", "raise SystemExit(23)"], [], timeout=10)
    except subprocess.CalledProcessError as error:
        if error.returncode != 23:
            raise
    else:
        raise RuntimeError("Fail-fast control did not propagate failure")
    print("PASS: lint negative/positive controls and command failure propagation", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("tier", choices=["lint", "fast", "integration", "probes"])
    args = parser.parse_args()
    if not NODE or not NPM:
        raise RuntimeError("Node/npm required")
    results = []
    report = {"tier": args.tier, "status": "RUNNING", "checks": results}
    try:
        if args.tier in {"lint", "fast"}:
            run("format", [NPM, "run", "format:check"], results)
            run("TypeScript/React lint", [NPM, "run", "lint:js"], results)
            run("Python safety lint", [PYTHON, "-m", "ruff", "check", "scripts", "apps/ai-engine", "services/payment-service"], results)
            lint_probes()
        if args.tier == "probes":
            lint_probes()
        if args.tier == "fast":
            run("all TypeScript builds", [NPM, "run", "build"], results)
            checkout = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "services/checkout-service/dist/test").glob("*.test.js"))
            api = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "apps/api/dist/test").glob("*.test.js") if p.name != "database.test.js")
            if not checkout or not api:
                raise RuntimeError("Compiled tests missing; refusing an empty test run")
            print("Unit tier excludes database.test.js; required integration tier runs it with real services.", flush=True)
            run("checkout unit/HTTP", [NODE, "--test", *checkout], results)
            run("API unit/HTTP (explicit non-database tier)", [NODE, "--test", *api], results)
            run("React unit/component", [NPM, "run", "test:web"], results)
            run("payment Python", [PYTHON, "-m", "pytest", "services/payment-service", "-q"], results)
            run("engine Python", [PYTHON, "-m", "pytest", "-c", "apps/ai-engine/pytest.ini", "apps/ai-engine/tests", "-q"], results)
            run("executor/security and check-runner Python", [PYTHON, "-m", "pytest", "scripts/tests", "-q"], results)
        if args.tier == "integration":
            env = {**os.environ, "TEST_KNOWLEDGE_REQUIRED": "1"}
            for label, command in [
                ("API/PostgreSQL/Redis/BullMQ/live evidence", ["scripts/verify-p3.py", "--task", "P3.5", "--with-evidence"]),
                ("deployment reader permissions", ["scripts/verify-p5-deployments.py"]),
                ("sequential/parallel live evidence", ["scripts/verify-p6.py"]),
                ("real embeddings/pgvector", ["scripts/verify-p7.py"]),
                ("real isolated Docker sandbox", ["scripts/verify-p8.py"]),
                ("real browser/RBAC/accessibility", ["scripts/verify-p9.py"]),
            ]:
                run(label, [PYTHON, *command], results, env=env, timeout=900)
        report["status"] = "PASSED"
    except BaseException as error:
        report.update(status="FAILED", error_type=type(error).__name__)
        raise
    finally:
        directory = ROOT / ".artifacts"
        directory.mkdir(exist_ok=True)
        (directory / f"ci-{args.tier}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"PASS: {args.tier} tier", flush=True)


if __name__ == "__main__":
    main()
