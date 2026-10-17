"""Local-only setup for a SELECT-only deployment-history login."""

import secrets
from urllib.parse import quote, urlsplit

import psycopg
from local_support import ROOT, local_env
from psycopg import sql


def grant_reader(conn, role, password):
    existing = conn.execute(
        "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls "
        "FROM pg_roles WHERE rolname=%s",
        (role,),
    ).fetchone()
    if existing and any(existing):
        raise ValueError("Refusing to alter a privileged existing role")
    if not existing:
        conn.execute(
            sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(
                sql.Identifier(role), sql.Literal(password)
            )
        )
    else:
        conn.execute(
            sql.SQL("ALTER ROLE {} PASSWORD {}").format(
                sql.Identifier(role), sql.Literal(password)
            )
        )
    database = conn.execute("SELECT current_database()").fetchone()[0]
    conn.execute(
        sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
            sql.Identifier(database), sql.Identifier(role)
        )
    )
    conn.execute(
        sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(role))
    )
    conn.execute(
        sql.SQL(
            "GRANT SELECT ON public.demo_versions,public.demo_deployments TO {}"
        ).format(sql.Identifier(role))
    )
    conn.execute(
        sql.SQL("ALTER ROLE {} SET default_transaction_read_only=on").format(
            sql.Identifier(role)
        )
    )


def prepare_reader():
    owner = local_env()["DATABASE_URL"]
    url = urlsplit(owner)
    if (
        url.hostname != "127.0.0.1"
        or url.path != "/sentinel"
        or url.username != "sentinel"
    ):
        raise ValueError("Reader setup only supports the dedicated local demo DB")
    path = ROOT / ".env.evidence"
    settings = (
        dict(
            line.split("=", 1)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#") and "=" in line
        )
        if path.exists()
        else {}
    )
    role = "sentinel_evidence_reader"
    password = (
        urlsplit(settings["SENTINEL_DEPLOYMENT_READ_URL"]).password
        if "SENTINEL_DEPLOYMENT_READ_URL" in settings
        else secrets.token_hex(24)
    )
    with psycopg.connect(owner, connect_timeout=3) as conn:
        grant_reader(conn, role, password)
    values = {
        "SENTINEL_DEPLOYMENT_READ_URL": f"postgresql://{role}:{quote(password, safe='')}@127.0.0.1:{url.port}/sentinel",
        "SENTINEL_EVIDENCE_SECRET": settings.get(
            "SENTINEL_EVIDENCE_SECRET", secrets.token_hex(32)
        ),
        "SENTINEL_PROMETHEUS_URL": "http://127.0.0.1:9090",
        "SENTINEL_LOKI_URL": "http://127.0.0.1:3100",
    }
    path.write_text(
        "".join(f"{key}={value}\n" for key, value in values.items()), encoding="utf-8"
    )
    print(
        "Local deployment reader prepared; ignored .env.evidence written; credentials omitted"
    )
    return values


if __name__ == "__main__":
    try:
        prepare_reader()
    except Exception:
        raise SystemExit(
            "Reader setup failed; check local database/migrations (credentials omitted)"
        ) from None
