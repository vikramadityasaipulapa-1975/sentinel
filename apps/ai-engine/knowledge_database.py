"""Bounded separate knowledge database connections; reader never gets owner DSN."""

from urllib.parse import urlsplit

import certifi
import psycopg
from psycopg.rows import dict_row


def connect(dsn: str, *, readonly: bool = True):
    url = urlsplit(dsn)
    if (
        url.scheme not in {"postgresql", "postgres"}
        or not url.hostname
        or not url.username
        or not url.password
        or url.query
        or url.fragment
        or not url.path.strip("/")
    ):
        raise ValueError("Invalid knowledge database URL")
    return psycopg.connect(
        dsn,
        connect_timeout=2,
        row_factory=dict_row,
        sslmode="disable"
        if url.hostname in {"127.0.0.1", "localhost"}
        else "verify-full",
        sslrootcert=certifi.where(),
        options="-c timezone=UTC -c statement_timeout=2000 -c lock_timeout=2000"
        + (" -c default_transaction_read_only=on" if readonly else ""),
    )
