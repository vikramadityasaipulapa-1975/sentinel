"""Only the reviewed on-disk manifest can select ingestion sources."""

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "knowledge"
SECTIONS = (
    "Scope",
    "Symptoms",
    "Possible causes",
    "Checks",
    "Remediation guidance",
    "Limitations",
)
CATEGORIES = {"deployment", "dependency", "application", "load", "telemetry"}


@dataclass(frozen=True)
class Document:
    id: str
    version: int
    path: str
    kind: str
    services: tuple[str, ...]
    categories: tuple[str, ...]
    title: str
    content: str
    sha256: str


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_catalog(root: Path = ROOT) -> list[Document]:
    root = root.resolve()
    raw = (root / "manifest.json").read_bytes()
    if len(raw) > 32768:
        raise ValueError("Manifest too large")
    rows = json.loads(raw)
    if not isinstance(rows, list) or not 1 <= len(rows) <= 20:
        raise ValueError("Expected a bounded manifest")
    documents = []
    ids, paths = set(), set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {
            "id",
            "version",
            "path",
            "kind",
            "services",
            "categories",
        }:
            raise ValueError("Invalid manifest fields")
        identifier, version, path = row["id"], row["version"], row["path"]
        if (
            not isinstance(identifier, str)
            or not re.fullmatch(r"[a-z][a-z0-9-]{1,59}", identifier)
            or identifier in ids
        ):
            raise ValueError("Invalid or duplicate document ID")
        if type(version) is not int or not 1 <= version <= 10000:
            raise ValueError("Invalid document version")
        if (
            not isinstance(path, str)
            or not re.fullmatch(r"(?:runbooks|postmortems)/[a-z0-9-]+\.md", path)
            or path in paths
        ):
            raise ValueError("Invalid or duplicate source path")
        resolved = (root / path).resolve()
        if not resolved.is_relative_to(root) or resolved.is_symlink():
            raise ValueError("Source must stay in the knowledge directory")
        services, categories = row["services"], row["categories"]
        if (
            not isinstance(services, list)
            or not services
            or len(set(services)) != len(services)
            or not set(services) <= {"checkout-service", "payment-service"}
            or not isinstance(categories, list)
            or not categories
            or not set(categories) <= CATEGORIES
            or len(set(categories)) != len(categories)
        ):
            raise ValueError("Invalid service/category metadata")
        data = resolved.read_bytes()
        if not 500 <= len(data) <= 16384:
            raise ValueError("Document size outside bounds")
        content = data.decode("utf-8").replace("\r\n", "\n")
        lines = content.splitlines()
        if not lines[0].startswith("# ") or any(
            f"## {section}" not in lines for section in SECTIONS
        ):
            raise ValueError("Missing title or required section")
        if row["kind"] not in {"runbook", "fictional-postmortem"}:
            raise ValueError("Invalid document kind")
        if row["kind"] == "fictional-postmortem" and (
            not path.startswith("postmortems/") or "fictional" not in content.lower()
        ):
            raise ValueError("Examples must declare that they are fictional")
        ids.add(identifier)
        paths.add(path)
        documents.append(
            Document(
                identifier,
                version,
                path,
                row["kind"],
                tuple(services),
                tuple(categories),
                lines[0][2:],
                content,
                digest(content),
            )
        )
    return documents
