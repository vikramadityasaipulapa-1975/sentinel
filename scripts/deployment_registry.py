"""Append deployment attempts; activate only after runtime identity verification."""

import sys
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(
    0, str(Path(__file__).resolve().parent.parent / "services/payment-service")
)
from config import VERSIONS, Settings


def connect(dsn):
    Settings(storage_mode="postgres", database_url=dsn)
    return psycopg.connect(
        dsn,
        connect_timeout=3,
        row_factory=dict_row,
        options="-c timezone=UTC -c statement_timeout=5000 -c lock_timeout=3000",
    )


def known_version(dsn, version):
    with connect(dsn) as conn:
        return conn.execute(
            "SELECT * FROM demo_versions WHERE version=%s", (version,)
        ).fetchone()


def register_version(dsn, version, source_sha, commit_sha=None, image_id=None):
    if version not in VERSIONS:
        raise ValueError("Unknown allowlisted version")
    with connect(dsn) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71622002)")
        row = conn.execute(
            "SELECT * FROM demo_versions WHERE version=%s", (version,)
        ).fetchone()
        if row:
            if (
                row["source_sha256"] != source_sha
                or row["configuration"] != VERSIONS[version]
                or (row["image_id"] and image_id and row["image_id"] != image_id)
            ):
                raise ValueError("Version content is immutable; create a new version")
            return
        conn.execute(
            "INSERT INTO demo_versions (version, service, source_sha256, commit_sha, image_id, configuration) VALUES (%s, 'payment-service', %s, %s, %s, %s)",
            (version, source_sha, commit_sha, image_id, Jsonb(VERSIONS[version])),
        )


def begin_deployment(dsn, version, backend):
    deployment_id = uuid4()
    with connect(dsn) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71622002)")
        conn.execute(
            "INSERT INTO demo_deployments (id, service, version, backend, status) VALUES (%s, 'payment-service', %s, %s, 'PENDING')",
            (deployment_id, version, backend),
        )
    return str(deployment_id)


def finish_deployment(dsn, deployment_id, identity=None):
    with connect(dsn) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71622002)")
        row = conn.execute(
            "SELECT d.*, v.source_sha256, v.commit_sha FROM demo_deployments d JOIN demo_versions v USING (version) WHERE d.id=%s FOR UPDATE OF d",
            (deployment_id,),
        ).fetchone()
        if not row or row["status"] != "PENDING":
            raise ValueError("Deployment is not pending")
        if identity is None:
            conn.execute(
                "UPDATE demo_deployments SET status='FAILED', finished_at=now() WHERE id=%s",
                (deployment_id,),
            )
            return
        if (
            identity.get("deployment_id") != deployment_id
            or identity.get("version") != row["version"]
            or identity.get("source_sha256") != row["source_sha256"]
            or identity.get("commit_sha") != (row["commit_sha"] or "unknown")
        ):
            raise ValueError("Runtime identity does not match pending deployment")
        conn.execute(
            "UPDATE demo_deployments SET status='SUPERSEDED', finished_at=now() WHERE service='payment-service' AND status='ACTIVE'"
        )
        conn.execute(
            "UPDATE demo_deployments SET status='ACTIVE', verified_at=now() WHERE id=%s",
            (deployment_id,),
        )
