"""Trusted local sandbox executor. Database approval is required for every attempt."""

import argparse
import json
import subprocess
import time
from uuid import UUID, uuid4

import psycopg
from filelock import FileLock
from local_support import ROOT
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from remediation_verification import classify
from sandbox_support import (
    Docker,
    assert_checkout,
    assert_container,
    load_config,
    probe,
    wait_version,
    write_images,
)


def connection(dsn):
    return psycopg.connect(
        dsn,
        connect_timeout=3,
        row_factory=dict_row,
        options="-c statement_timeout=5000 -c lock_timeout=3000",
    )


def audit(conn, row, observations=None):
    conn.execute(
        "INSERT INTO sentinel_api.remediation_events(action_id,status,actor_id,observations) VALUES (%s,%s,%s,%s)",
        (
            row["id"],
            row["status"],
            None,
            Jsonb(observations) if observations is not None else None,
        ),
    )
    conn.execute(
        "INSERT INTO sentinel_api.incident_events(id,incident_id,type,remediation_id,payload_json) VALUES (%s,%s,'REMEDIATION',%s,%s)",
        (
            uuid4(),
            row["incident_id"],
            row["id"],
            Jsonb({"remediation_id": str(row["id"]), "status": row["status"]}),
        ),
    )


def authorized(conn, row):
    u = conn.execute(
        "SELECT role,enabled,token_version FROM sentinel_api.users WHERE id=%s FOR SHARE",
        (row["decided_by"],),
    ).fetchone()
    incident = conn.execute(
        "SELECT i.status,s.name FROM sentinel_api.incidents i JOIN sentinel_api.services s ON s.id=i.service_id WHERE i.id=%s FOR UPDATE OF i",
        (row["incident_id"],),
    ).fetchone()
    valid = conn.execute(
        "SELECT %s::timestamptz>statement_timestamp() AS valid", (row["expires_at"],)
    ).fetchone()["valid"]
    return bool(
        u
        and u["role"] == "ADMIN"
        and u["enabled"]
        and u["token_version"] == row["approver_token_version"]
        and incident
        and incident["name"] == "payment-service"
        and incident["status"] not in {"RESOLVED", "CLOSED"}
        and valid
    )


def claim(dsn, identifier, config):
    with connection(dsn) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71628001)")
        row = conn.execute(
            "SELECT * FROM sentinel_api.remediation_actions WHERE id=%s FOR UPDATE",
            (identifier,),
        ).fetchone()
        if not row or row["status"] != "APPROVED":
            return None
        if (
            not authorized(conn, row)
            or row["action"] != "ROLLBACK_SANDBOX_PAYMENT"
            or row["binding_json"] != config["binding"]
        ):
            row = conn.execute(
                "UPDATE sentinel_api.remediation_actions SET status='CANCELLED' WHERE id=%s RETURNING *",
                (identifier,),
            ).fetchone()
            audit(conn, row, {"code": "AUTHORIZATION_OR_BINDING_CHANGED"})
            return None
        row = conn.execute(
            "UPDATE sentinel_api.remediation_actions SET status='EXECUTING',execution_token=%s,started_at=statement_timestamp() WHERE id=%s RETURNING *",
            (uuid4(), identifier),
        ).fetchone()
        audit(conn, row)
        return row


def finish(dsn, row, status, observations):
    with connection(dsn) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71628001)")
        saved = conn.execute(
            "UPDATE sentinel_api.remediation_actions SET status=%s,finished_at=statement_timestamp(),result_json=%s WHERE id=%s AND status='EXECUTING' AND execution_token=%s RETURNING *",
            (status, Jsonb(observations), row["id"], row["execution_token"]),
        ).fetchone()
        if saved:
            audit(conn, saved, observations)
            conn.execute(
                "DELETE FROM sentinel_api.sandbox_binding WHERE project=%s AND binding_json=%s",
                (saved["project"], Jsonb(saved["binding_json"])),
            )
        return bool(saved)


def assert_authorized(dsn, row):
    with connection(dsn) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71628001)")
        current = conn.execute(
            "SELECT * FROM sentinel_api.remediation_actions WHERE id=%s AND status='EXECUTING' AND execution_token=%s FOR UPDATE",
            (row["id"], row["execution_token"]),
        ).fetchone()
        if not current or not authorized(conn, current):
            raise ValueError("Approval expired, revoked or superseded")


def execute(dsn, identifier):
    identifier = UUID(str(identifier))
    with FileLock(str(ROOT / ".artifacts/p8-executor.lock"), timeout=0):
        config = load_config()
        docker = Docker(config["context"])
        row = claim(dsn, identifier, config)
        if not row:
            return {"status": "NO_EXECUTION"}
        binding = config["binding"]
        invoked = False
        try:
            assert_checkout(docker, config)
            before = docker.payment()
            assert_container(before, binding["current_image"], binding["container_id"])
            # Recheck live backend authorization immediately before the external effect.
            assert_authorized(dsn, row)
            write_images(binding["target_image"], config["checkout_image"])
            invoked = True
            docker.compose(
                "up", "-d", "--no-build", "--pull", "never", "--no-deps", "payment"
            )
            wait_version(binding["target_version"])
            after = docker.payment()
            assert_container(after, binding["target_image"])
            observations = probe(binding["target_version"])
            observations["image_matches"] = after["Image"] == binding["target_image"]
            assert_checkout(docker, config)
            final = docker.payment()
            assert_container(final, binding["target_image"], after["Id"])
            status = classify(observations)
        except subprocess.CalledProcessError:
            observations = {
                "code": "COMMAND_FAILED_OUTCOME_UNKNOWN",
                "outcome_uncertain": True,
            }
            try:
                assert_container(
                    docker.payment(), binding["current_image"], binding["container_id"]
                )
                observations = {
                    "code": "COMMAND_FAILED_UNCHANGED",
                    "command_failed_unchanged": True,
                }
            except Exception:
                pass
            status = classify(observations)
        except Exception:
            # A timed-out command might already have changed the container. Never retry blindly.
            status = "UNVERIFIED" if invoked else "FAILED"
            observations = {
                "code": "EXECUTION_OUTCOME_UNCERTAIN"
                if invoked
                else "PRECONDITION_FAILED",
                "command_invoked": invoked,
            }
        if not finish(dsn, row, status, observations):
            return {"status": "FENCED"}
        return {"status": status, "observations": observations}


def reconcile(dsn, identifier):
    # A crash is not permission to perform another Docker mutation.
    with FileLock(str(ROOT / ".artifacts/p8-executor.lock"), timeout=0):
        with connection(dsn) as conn:
            row = conn.execute(
                "SELECT * FROM sentinel_api.remediation_actions WHERE id=%s AND status='EXECUTING' AND started_at<statement_timestamp()-interval '2 minutes' FOR UPDATE",
                (UUID(str(identifier)),),
            ).fetchone()
        if not row:
            return {"status": "NO_RECONCILIATION"}
        observations = {
            "code": "ABANDONED_ATTEMPT_REQUIRES_HUMAN_REVIEW",
            "command_repeated": False,
        }
        finish(dsn, row, "UNVERIFIED", observations)
        return {"status": "UNVERIFIED", "observations": observations}


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--action")
    modes.add_argument("--watch", action="store_true")
    parser.add_argument("--reconcile", action="store_true")
    args = parser.parse_args()
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "sandbox_setup", ROOT / "scripts/sandbox-local.py"
    )
    setup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(setup)
    values = setup.api_settings()
    if args.watch:
        if args.reconcile:
            parser.error("Reconciliation requires an explicit --action")
        print(
            "Sandbox executor watching durable approved actions; no AI tool can authorize execution",
            flush=True,
        )
        while True:
            with connection(values["SENTINEL_DATABASE_URL"]) as conn:
                row = conn.execute(
                    "SELECT id FROM sentinel_api.remediation_actions WHERE project='sentinel-remediation-sandbox' AND status='APPROVED' ORDER BY created_at LIMIT 1"
                ).fetchone()
            if row:
                print(
                    json.dumps(execute(values["SENTINEL_DATABASE_URL"], row["id"])),
                    flush=True,
                )
            time.sleep(1)
    result = (reconcile if args.reconcile else execute)(
        values["SENTINEL_DATABASE_URL"], args.action
    )
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(
            "Executor stopped; inspect any EXECUTING action before restarting/reconciling"
        )
    except Exception:
        raise SystemExit(
            "Executor failed closed; inspect action history and sandbox setup (credentials omitted)"
        ) from None
