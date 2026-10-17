"""Real PostgreSQL permission checks with isolated, explicitly synthetic releases."""

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
from evidence_support import grant_reader
from local_support import ROOT, local_env
from psycopg import sql

sys.path.insert(0, str(ROOT / "apps/ai-engine"))
from evidence.deployments import query_deployments  # noqa: E402
from evidence.models import Window  # noqa: E402


def main():
    owner = local_env()["DATABASE_URL"]
    suffix = uuid4().hex[:8]
    database, role, password = (
        "sentinel_p5_" + suffix,
        "evidence_p5_" + suffix,
        uuid4().hex,
    )
    info = psycopg.conninfo.conninfo_to_dict(owner)
    with psycopg.connect(owner, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
        try:
            test = psycopg.conninfo.make_conninfo(**{**info, "dbname": database})
            with psycopg.connect(test) as conn:
                for path in sorted((ROOT / "database/migrations").glob("*.sql")):
                    conn.execute(path.read_text(encoding="utf-8"))
                conn.execute(
                    "INSERT INTO demo_versions(version,service,source_sha256,configuration) VALUES ('fixture-v1','payment-service',%s,'{}')",
                    ("a" * 64,),
                )
                conn.execute(
                    "INSERT INTO demo_deployments(id,service,version,backend,status,verified_at) VALUES (%s,'payment-service','fixture-v1','native','ACTIVE',now())",
                    (uuid4(),),
                )
                grant_reader(conn, role, password)
            reader = f"postgresql://{role}:{password}@127.0.0.1:55432/{database}"

            async def check():
                end = datetime.now(timezone.utc)
                window = Window(
                    service="payment-service", start=end - timedelta(minutes=5), end=end
                )
                value = await query_deployments(reader, window)
                assert (
                    value.status == "OK" and value.data["verified_release_count"] == 1
                )
                assert value.data["releases"][0]["version"] == "fixture-v1"
                empty = await query_deployments(
                    reader, window.model_copy(update={"service": "checkout-service"})
                )
                assert empty.status == "EMPTY"

            asyncio.run(check())
            with psycopg.connect(reader, autocommit=True) as conn:
                # Disable the convenience default to prove real GRANT boundaries.
                conn.execute("SET default_transaction_read_only=off")
                for statement in [
                    "DELETE FROM demo_deployments",
                    "SELECT * FROM demo_payments",
                    "CREATE TABLE public.forbidden(id int)",
                ]:
                    try:
                        conn.execute(statement)
                    except psycopg.errors.InsufficientPrivilege:
                        continue
                    raise AssertionError(
                        "Reader permissions allowed forbidden operation"
                    )
            print(
                "P5.3 real PostgreSQL: synthetic release read, empty service, DELETE/payment-read/DDL denied"
            )
        finally:
            # Only this run's isolated database and role; never the demo database.
            admin.execute(sql.SQL("DROP DATABASE {}").format(sql.Identifier(database)))
            admin.execute(
                sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(role))
            )


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
