import asyncio
from urllib.parse import urlsplit

import psycopg
from psycopg.rows import dict_row

from .models import Window, result


def validate_dsn(dsn):
    url = urlsplit(dsn)
    if (
        url.scheme not in {"postgres", "postgresql"}
        or not url.hostname
        or not url.username
        or not url.password
        or url.query
        or url.fragment
    ):
        raise ValueError("Invalid deployment-reader DSN")
    return url


async def query_deployments(dsn: str, window: Window):
    url = validate_dsn(dsn)
    # No credentials/hostnames in persisted SQL locators.
    locator = {
        "database": "monitored-deployment-registry",
        "tables": ["public.demo_deployments", "public.demo_versions"],
        "filter": "service + [start,end), verified_at for releases; deployed_at for attempts",
        "limit": 50,
    }
    try:

        async def read():
            conn = await psycopg.AsyncConnection.connect(
                dsn,
                connect_timeout=2,
                row_factory=dict_row,
                sslmode="disable"
                if url.hostname in {"127.0.0.1", "localhost"}
                else "verify-full",
                options="-c default_transaction_read_only=on -c statement_timeout=1500 -c timezone=UTC",
            )
            async with conn:
                cursor = await conn.execute(
                    "SELECT d.id,d.service,d.version,d.status,d.backend,d.deployed_at,"
                    "d.verified_at,v.commit_sha,v.source_sha256 FROM public.demo_deployments d "
                    "JOIN public.demo_versions v ON v.version=d.version "
                    "WHERE d.service=%s AND COALESCE(d.verified_at,d.deployed_at)>=%s "
                    "AND COALESCE(d.verified_at,d.deployed_at)<%s "
                    "ORDER BY COALESCE(d.verified_at,d.deployed_at) DESC,d.id DESC LIMIT 51",
                    (window.service, window.start, window.end),
                )
                return await cursor.fetchall()

        rows = await asyncio.wait_for(read(), 2.5)
        records = []
        for row in rows[:50]:
            records.append(
                {
                    key: value.isoformat()
                    if hasattr(value, "isoformat")
                    else str(value)
                    if key == "id"
                    else value
                    for key, value in row.items()
                }
            )
        return result(
            "deployments",
            window,
            locator,
            "PARTIAL" if len(rows) > 50 else "OK" if rows else "EMPTY",
            releases=records,
            truncated=len(rows) > 50,
            verified_release_count=sum(
                row["verified_at"] is not None for row in rows[:50]
            ),
        )
    except (psycopg.Error, asyncio.TimeoutError):
        return result("deployments", window, locator, "UNAVAILABLE")
