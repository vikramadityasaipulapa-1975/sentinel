"""Reject corrupt tool downloads before any external executable runs."""

import hashlib
import io
from pathlib import Path
import sys
import zipfile
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from security_scan import binary_bytes
import security_scan


def test_corrupt_archive_is_rejected_before_opening():
    with pytest.raises(ValueError, match="checksum mismatch"):
        binary_bytes(b"not a valid binary", "0" * 64, True)


def test_only_expected_member_bytes_are_read_without_extracting_paths(monkeypatch):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("gitleaks.exe", b"test fixture bytes, not executable")
        archive.writestr("../../outside", b"must not be extracted")
    raw = stream.getvalue()

    def forbidden(*_args, **_kwargs):
        raise AssertionError("Archive paths must never be extracted")

    monkeypatch.setattr(zipfile.ZipFile, "extract", forbidden)
    monkeypatch.setattr(zipfile.ZipFile, "extractall", forbidden)
    assert (
        binary_bytes(raw, hashlib.sha256(raw).hexdigest(), True)
        == b"test fixture bytes, not executable"
    )


def test_unredacted_scanner_output_cannot_enter_safe_summary(monkeypatch, tmp_path):
    import json
    from types import SimpleNamespace

    (tmp_path / ".artifacts").mkdir()
    monkeypatch.setattr(security_scan, "ROOT", tmp_path)
    output = tmp_path / "report.json"
    output.write_text(
        json.dumps([{"Secret": "not-redacted-fixture"}]), encoding="utf-8"
    )
    monkeypatch.setattr(
        security_scan.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=17),
    )
    with pytest.raises(RuntimeError, match="not fully redacted"):
        security_scan.scan(
            tmp_path / "unused-tool", "stdin", None, output, "safe fixture"
        )
