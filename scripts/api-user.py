"""Interactive local account management; passwords never enter command arguments."""

import argparse
import getpass
import json
import shutil
import subprocess
import sys
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "action", choices=["create", "password", "role", "enable", "disable"]
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--role", choices=["VIEWER", "OPERATOR", "ADMIN"])
    args = parser.parse_args()
    if args.action in {"create", "role"} and not args.role:
        parser.error("--role is required for create/role; no default administrator")
    path = ROOT / ".env.api"
    node = shutil.which("node")
    if (
        not node
        or not path.is_file()
        or not (ROOT / "apps/api/dist/src/user-cli.js").is_file()
    ):
        raise RuntimeError("Prepare/build the API first")
    data = {"action": args.action, "email": args.email, "role": args.role}
    if args.action in {"create", "password"}:
        if not sys.stdin.isatty():
            raise RuntimeError("Use an interactive terminal for hidden password entry")
        warnings.simplefilter("error", getpass.GetPassWarning)
        password = getpass.getpass("Password (12-128 characters; hidden): ")
        if password != getpass.getpass("Confirm password (hidden): "):
            raise ValueError("Passwords do not match")
        data["password"] = password
    subprocess.run(
        [node, f"--env-file={path}", "apps/api/dist/src/user-cli.js"],
        cwd=ROOT,
        input=json.dumps(data),
        text=True,
        check=True,
        timeout=30,
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Account operation cancelled")
    except Exception:
        raise SystemExit(
            "Local account operation did not complete; check password policy, terminal, build/database and existing email (credentials omitted)"
        ) from None
