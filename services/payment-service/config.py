"""Startup-only demo fault settings; no request can enable a fault."""

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

VERSIONS = json.loads(
    Path(__file__).with_name("versions.json").read_text(encoding="utf-8")
)


@dataclass(frozen=True)
class Settings:
    fault_mode: str = "normal"
    fault_delay_ms: int = 500
    storage_mode: str = "memory"
    database_url: str | None = field(default=None, repr=False)
    version: str = "unversioned"
    source_sha256: str = "unknown"
    commit_sha: str = "unknown"
    deployment_id: str = "unregistered"

    def __post_init__(self):
        if self.fault_mode not in {"normal", "latency", "error"}:
            raise ValueError("PAYMENT_FAULT_MODE must be normal, latency, or error")
        if type(self.fault_delay_ms) is not int or not 1 <= self.fault_delay_ms <= 5000:
            raise ValueError("PAYMENT_FAULT_DELAY_MS must be from 1 to 5000")
        if self.storage_mode not in {"memory", "postgres"}:
            raise ValueError("STORAGE_MODE must be memory or postgres")
        if self.storage_mode == "postgres":
            url = urlsplit(self.database_url or "")
            if (
                url.scheme not in {"postgres", "postgresql"}
                or url.hostname
                not in {
                    "127.0.0.1",
                    "localhost",
                    "db",
                }
                or url.username != "sentinel"
                or url.path not in {"/sentinel", "/sentinel_p2"}
                or url.query
                or url.fragment
            ):
                raise ValueError("PostgreSQL mode requires a local demo DATABASE_URL")
        if self.version != "unversioned":
            if self.version not in VERSIONS or VERSIONS[self.version] != {
                "fault_mode": self.fault_mode,
                "fault_delay_ms": self.fault_delay_ms,
            }:
                raise ValueError("Version must match its immutable demo profile")
        if self.source_sha256 != "unknown" and not re.fullmatch(
            r"[0-9a-f]{64}", self.source_sha256
        ):
            raise ValueError("Invalid source checksum")
        if self.commit_sha != "unknown" and not re.fullmatch(
            r"[0-9a-f]{40}", self.commit_sha
        ):
            raise ValueError("Invalid commit SHA")
        if self.deployment_id != "unregistered":
            try:
                UUID(self.deployment_id)
            except ValueError:
                raise ValueError("Invalid deployment ID") from None

    @classmethod
    def from_env(cls):
        try:
            delay = int(os.getenv("PAYMENT_FAULT_DELAY_MS", "500"))
        except ValueError:
            raise ValueError("PAYMENT_FAULT_DELAY_MS must be from 1 to 5000") from None
        version = os.getenv("PAYMENT_VERSION", "unversioned")
        if version != "unversioned" and version not in VERSIONS:
            raise ValueError("Unknown payment version")
        profile = VERSIONS.get(
            version,
            {
                "fault_mode": os.getenv("PAYMENT_FAULT_MODE", "normal"),
                "fault_delay_ms": delay,
            },
        )
        return cls(
            **profile,
            storage_mode=os.getenv("STORAGE_MODE", "memory"),
            database_url=os.getenv("DATABASE_URL"),
            version=version,
            source_sha256=os.getenv("SOURCE_SHA256", "unknown"),
            commit_sha=os.getenv("GIT_COMMIT", "unknown"),
            deployment_id=os.getenv("DEPLOYMENT_ID", "unregistered"),
        )
