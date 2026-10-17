"""Prepare the isolated local knowledge DB and ingest reviewed sources."""

import argparse
import hashlib
import json
import secrets
import subprocess
import sys
import time
from urllib.parse import urlsplit

import httpx
from local_support import ROOT, docker_executable
from psycopg import sql

sys.path.insert(0, str(ROOT / "apps/ai-engine"))
from knowledge_database import connect  # noqa: E402
from knowledge_embeddings import DEFAULT_CACHE, PROFILE, LocalEmbedder  # noqa: E402
from knowledge_ingest import ingest  # noqa: E402


def settings():
    path = ROOT / ".env.knowledge"
    if not path.exists():
        password = secrets.token_hex(24)
        reader = secrets.token_hex(24)
        path.write_text(
            f"SENTINEL_KNOWLEDGE_PASSWORD={password}\nSENTINEL_KNOWLEDGE_OWNER_URL=postgresql://knowledge_owner:{password}@127.0.0.1:55436/sentinel_knowledge\nSENTINEL_KNOWLEDGE_READ_URL=postgresql://knowledge_reader:{reader}@127.0.0.1:55436/sentinel_knowledge\n",
            encoding="utf-8",
        )
    values = dict(
        line.split("=", 1)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#")
    )
    for key, role in (
        ("SENTINEL_KNOWLEDGE_OWNER_URL", "knowledge_owner"),
        ("SENTINEL_KNOWLEDGE_READ_URL", "knowledge_reader"),
    ):
        url = urlsplit(values[key])
        if (
            url.hostname != "127.0.0.1"
            or url.port != 55436
            or url.path != "/sentinel_knowledge"
            or url.username != role
            or url.query
            or url.fragment
        ):
            raise ValueError(
                "Helper requires its dedicated loopback knowledge database"
            )
    return values


def download_model():
    profile = json.loads(PROFILE.read_text(encoding="utf-8"))
    DEFAULT_CACHE.mkdir(parents=True, exist_ok=True)
    with httpx.Client(
        follow_redirects=True, timeout=httpx.Timeout(30, connect=10), trust_env=False
    ) as client:
        for name, expected in profile["files"].items():
            target = DEFAULT_CACHE / name
            if (
                target.is_file()
                and hashlib.sha256(target.read_bytes()).hexdigest() == expected
            ):
                continue
            started = time.monotonic()
            partial = DEFAULT_CACHE / (name + ".part")
            size = 0
            with client.stream(
                "GET",
                f"https://huggingface.co/{profile['repository']}/resolve/{profile['revision']}/{name}",
            ) as response:
                response.raise_for_status()
                with partial.open("wb") as handle:
                    for chunk in response.iter_bytes(262144):
                        size += len(chunk)
                        if size > 256 * 1024 * 1024 or time.monotonic() - started > 600:
                            raise ValueError("Model download budget exceeded")
                        handle.write(chunk)
            if hashlib.sha256(partial.read_bytes()).hexdigest() != expected:
                raise ValueError("Model download hash mismatch")
            partial.replace(target)
            print("Prepared pinned model artifact:", name, flush=True)


def prepare_database(values):
    command = [
        docker_executable(),
        "compose",
        "--env-file",
        str(ROOT / ".env.knowledge"),
        "-f",
        str(ROOT / "infrastructure/compose.knowledge.yaml"),
    ]
    subprocess.run(
        command + ["up", "-d", "--wait", "knowledge-db"],
        cwd=ROOT,
        check=True,
        timeout=600,
    )
    with connect(values["SENTINEL_KNOWLEDGE_OWNER_URL"], readonly=False) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71627000)")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS public.knowledge_schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL)"
        )
        known = {
            row["name"]: row["sha256"]
            for row in conn.execute(
                "SELECT * FROM public.knowledge_schema_migrations"
            ).fetchall()
        }
        files = sorted((ROOT / "database/knowledge-migrations").glob("*.sql"))
        if set(known) - {p.name for p in files}:
            raise ValueError("Knowledge migration missing from source")
        for path in files:
            source = path.read_text(encoding="utf-8")
            checksum = hashlib.sha256(source.encode()).hexdigest()
            if path.name in known:
                if known[path.name] != checksum:
                    raise ValueError("Knowledge migration checksum changed")
                continue
            conn.execute(source)
            conn.execute(
                "INSERT INTO public.knowledge_schema_migrations VALUES (%s,%s)",
                (path.name, checksum),
            )
        password = urlsplit(values["SENTINEL_KNOWLEDGE_READ_URL"]).password
        role = conn.execute(
            "SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname='knowledge_reader'"
        ).fetchone()
        if role and any(role.values()):
            raise ValueError("Unexpected privileged reader role")
        if not role:
            conn.execute(
                sql.SQL("CREATE ROLE knowledge_reader LOGIN PASSWORD {}").format(
                    sql.Literal(password)
                )
            )
        conn.execute("GRANT CONNECT ON DATABASE sentinel_knowledge TO knowledge_reader")
        conn.execute("GRANT USAGE ON SCHEMA sentinel_knowledge TO knowledge_reader")
        conn.execute(
            "GRANT SELECT ON sentinel_knowledge.documents,sentinel_knowledge.chunks TO knowledge_reader"
        )
        conn.execute("ALTER ROLE knowledge_reader SET default_transaction_read_only=on")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-only", action="store_true")
    args = parser.parse_args()
    values = settings()
    prepare_database(values)
    if not args.database_only:
        download_model()
        report = ingest(values["SENTINEL_KNOWLEDGE_OWNER_URL"], LocalEmbedder())
        print(json.dumps(report), flush=True)
    print(
        "Knowledge setup complete; ignored config and retained volume; credentials omitted",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(
            "Knowledge setup failed; inspect source validation, model cache and local database (credentials omitted)"
        ) from None
