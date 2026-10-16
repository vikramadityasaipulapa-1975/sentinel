"""Single migration owner. Transactional, serialized, checksum-verified SQL files."""

import hashlib
import os
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services/payment-service"))


def migrate(dsn: str, directory: Path | None = None) -> list[str]:
    from config import Settings

    Settings(storage_mode="postgres", database_url=dsn)
    applied = []
    with psycopg.connect(
        dsn,
        connect_timeout=3,
        options="-c timezone=UTC -c statement_timeout=10000 -c lock_timeout=5000",
    ) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71622001)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        known = dict(
            conn.execute("SELECT name, checksum FROM schema_migrations").fetchall()
        )
        files = sorted((directory or ROOT / "database/migrations").glob("*.sql"))
        if set(known) - {path.name for path in files}:
            raise RuntimeError("Applied migration is missing from source")
        for path in files:
            source = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(source.encode()).hexdigest()
            if path.name in known:
                if known[path.name] != checksum:
                    raise RuntimeError("Applied migration checksum mismatch")
                continue
            conn.execute(source)
            conn.execute(
                "INSERT INTO schema_migrations (name, checksum) VALUES (%s, %s)",
                (path.name, checksum),
            )
            applied.append(path.name)
    return applied


if __name__ == "__main__":
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise SystemExit("DATABASE_URL is required; no schema changes performed")
    try:
        names = migrate(dsn)
        print(
            "Migrations applied: "
            + (", ".join(names) if names else "none (already current)")
        )
    except Exception:
        raise SystemExit(
            "Migration failed; inspect database availability/schema history (credentials omitted)"
        ) from None
