"""Pinned local Gitleaks scan. Never emits secret values or uploads source."""

import hashlib
import io
import json
import os
from pathlib import Path
import platform
import secrets
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = "8.30.1"
# Official GitHub release asset digests, verified on 2026-10-20 IST.
ASSETS = {
    "Windows": (
        "windows_x64.zip",
        "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
    ),
    "Linux": (
        "linux_x64.tar.gz",
        "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    ),
}


def binary_bytes(raw, expected, windows):
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError("Scanner archive checksum mismatch; refusing execution")
    name = "gitleaks.exe" if windows else "gitleaks"
    if windows:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            member = archive.getinfo(name)
            if member.file_size > 64 * 1024 * 1024:
                raise ValueError("Scanner binary exceeds budget")
            return archive.read(name)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as archive:
        member = archive.getmember(name)
        if not member.isfile() or member.size > 64 * 1024 * 1024:
            raise ValueError("Invalid scanner binary member")
        return archive.extractfile(member).read()


def scanner():
    system = platform.system()
    if system not in ASSETS or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise RuntimeError("Pinned scanner supports Windows/Linux x64 only")
    suffix, expected = ASSETS[system]
    directory = ROOT / ".tools" / ("gitleaks-" + VERSION)
    if not directory.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError("Scanner directory leaves workspace")
    directory.mkdir(parents=True, exist_ok=True)
    cache = directory / suffix
    if cache.is_symlink():
        raise ValueError("Refusing scanner cache symlink")
    if cache.is_file() and cache.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Scanner cache exceeds archive budget")
    raw = cache.read_bytes() if cache.is_file() else b""
    if hashlib.sha256(raw).hexdigest() != expected:
        url = f"https://github.com/gitleaks/gitleaks/releases/download/v{VERSION}/gitleaks_{VERSION}_{suffix}"
        request = urllib.request.Request(
            url, headers={"User-Agent": "Sentinel-security-review"}
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(32 * 1024 * 1024 + 1)
        if len(raw) > 32 * 1024 * 1024:
            raise ValueError("Scanner archive exceeds download budget")
        # Verify before caching or executing any extracted bytes.
        binary_bytes(raw, expected, system == "Windows")
        cache.write_bytes(raw)
    binary = binary_bytes(raw, expected, system == "Windows")
    target = directory / ("gitleaks.exe" if system == "Windows" else "gitleaks")
    if target.is_symlink():
        raise ValueError("Refusing scanner executable symlink")
    if not target.is_file() or target.read_bytes() != binary:
        target.write_bytes(binary)
    if system == "Linux":
        target.chmod(0o755)
    return target


def scan(tool, mode, target, output, source=None, log_opts=None):
    empty_ignore = ROOT / ".artifacts" / "security-empty-ignore"
    empty_ignore.write_text("", encoding="utf-8")
    argv = [
        str(tool),
        mode,
        "--no-banner",
        "--redact=100",
        "--ignore-gitleaks-allow",
        "--gitleaks-ignore-path",
        str(empty_ignore),
        "--timeout=120",
        "--exit-code=17",
        "--log-level=error",
        "--report-format=json",
        "--report-path",
        str(output),
        "--config",
        str(ROOT / ".gitleaks.toml"),
    ]
    if log_opts:
        argv += ["--log-opts", log_opts]
    if target:
        argv.append(str(target))
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("GITLEAKS_")
    }
    result = subprocess.run(
        argv,
        cwd=ROOT,
        env=env,
        input=source,
        text=True,
        capture_output=True,
        timeout=180,
    )
    if result.returncode not in {0, 17}:
        raise RuntimeError(
            "Secret scan did not complete; no raw scanner output emitted"
        )
    findings = json.loads(output.read_text(encoding="utf-8")) if output.exists() else []
    if bool(findings) != (result.returncode == 17):
        raise RuntimeError("Scanner exit code and findings disagree")
    if any(row.get("Secret") not in {"", "REDACTED"} for row in findings):
        raise RuntimeError("Scanner report was not fully redacted; refusing summary")
    # Only reviewed metadata leaves this function. Match/Secret/line text never do.
    return [
        {
            "rule": row["RuleID"],
            "file": row["File"],
            "line": row["StartLine"],
            "commit": row.get("Commit", ""),
        }
        for row in findings
    ]


def main():
    artifacts = ROOT / ".artifacts"
    if artifacts.is_symlink() or not artifacts.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError("Owned scan artifacts must stay inside workspace")
    artifacts.mkdir(exist_ok=True)
    report = {
        "status": "RUNNING",
        "scanner_version": VERSION,
        "findings": [],
        "controls_passed": False,
    }
    try:
        tool = scanner()
        # A syntactically plausible random test value, never a real provider key.
        marker = "ghp_" + "".join(
            secrets.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") for _ in range(36)
        )
        control = scan(
            tool,
            "stdin",
            None,
            artifacts / "security-negative-redacted.json",
            f'github_token = "{marker}"\n',
        )
        if not any(row["rule"] == "github-pat" for row in control) or scan(
            tool,
            "stdin",
            None,
            artifacts / "security-positive-redacted.json",
            'public_label = "safe example"\n',
        ):
            raise RuntimeError("Scanner positive/negative controls failed")
        report["controls_passed"] = True
        with tempfile.TemporaryDirectory(
            prefix="sentinel-security-control-", dir=artifacts
        ) as temporary:
            control_root = Path(temporary)
            reviewed = control_root / "knowledge"
            reviewed.mkdir()
            (reviewed / "embedding-model.json").write_text(
                json.dumps({"token": marker}), encoding="utf-8"
            )
            if not any(
                row["rule"] == "github-pat"
                for row in scan(
                    tool,
                    "dir",
                    control_root,
                    artifacts / "security-path-control-redacted.json",
                )
            ):
                raise RuntimeError(
                    "Reviewed public-hash path must still detect provider keys"
                )
        tracked = (
            subprocess.run(
                ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True
            )
            .stdout.decode("utf-8")
            .split("\0")
        )
        present = (
            subprocess.run(
                ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
                cwd=ROOT,
                check=True,
                capture_output=True,
            )
            .stdout.decode("utf-8")
            .split("\0")
        )
        for name in filter(None, tracked):
            base = Path(name).name.lower()
            if (base == ".env" or base.startswith(".env.")) and base != ".env.example":
                raise RuntimeError(
                    "Tracked secret configuration file found; review without printing values"
                )
        with tempfile.TemporaryDirectory(
            prefix="sentinel-security-", dir=artifacts
        ) as temporary:
            exported = Path(temporary)
            copied = 0
            for name in sorted(set(filter(None, present))):
                source = ROOT / name
                if source.is_symlink() or not source.resolve().is_relative_to(
                    ROOT.resolve()
                ):
                    raise RuntimeError("Worktree scan refuses symlinks/outside paths")
                if not source.is_file():
                    continue  # A tracked deletion is covered by the history scan.
                target = exported / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
                copied += 1
            worktree = scan(
                tool, "dir", exported, artifacts / "security-worktree-redacted.json"
            )
            # Temp paths vary; retain only repository-relative paths in safe output.
            for row in worktree:
                file = Path(row["file"])
                if file.is_absolute():
                    row["file"] = str(file.relative_to(exported))
            report["findings"].extend(worktree)
        shallow = subprocess.run(
            ["git", "rev-parse", "--is-shallow-repository"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        if shallow != "false":
            raise RuntimeError(
                "Full reachable-history scan requires an unshallow checkout"
            )
        report["reachable_commits"] = int(
            subprocess.run(
                ["git", "rev-list", "--all", "--count"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=True,
            ).stdout
        )
        report["worktree_files"] = copied
        report["findings"].extend(
            scan(
                tool,
                "git",
                ROOT,
                artifacts / "security-history-redacted.json",
                log_opts="--all --full-history -m",
            )
        )
        report["status"] = "FAILED" if report["findings"] else "PASSED"
    except BaseException as error:
        report.update(status="FAILED", error_type=type(error).__name__)
        raise
    finally:
        (artifacts / "security-summary.json").write_text(
            json.dumps(report, indent=2), encoding="utf-8"
        )
    print(json.dumps(report, indent=2), flush=True)
    if report["status"] != "PASSED":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
