"""Killable retrieval subprocess: bounded native work, including Windows selectors."""

import asyncio
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

from knowledge_retrieval import QUERIES, context

SLOTS = threading.BoundedSemaphore(2)


def _run(env, service, category):
    if not SLOTS.acquire(blocking=False):
        return context("UNAVAILABLE")
    try:
        child_env = {
            key: value
            for key, value in os.environ.items()
            if key.upper()
            in {
                "PATH",
                "SYSTEMROOT",
                "WINDIR",
                "TEMP",
                "TMP",
                "PYTHONPATH",
                "USERPROFILE",
                "LOCALAPPDATA",
            }
        }
        child_env["SENTINEL_KNOWLEDGE_READ_URL"] = env["SENTINEL_KNOWLEDGE_READ_URL"]
        raw = json.dumps(
            {"query": QUERIES[category], "service": service, "category": category}
        ).encode()
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("knowledge_retrieval.py"))],
            input=raw,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=child_env,
            timeout=5,
            check=True,
        )
        if len(result.stdout) > 16384:
            raise ValueError("Context too large")
        return json.loads(result.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return context("UNAVAILABLE")
    finally:
        SLOTS.release()


async def retrieve(env, service, report):
    if not env.get("SENTINEL_KNOWLEDGE_READ_URL"):
        return context("DISABLED")
    category = (
        report["hypotheses"][0]["category"] if report["hypotheses"] else "telemetry"
    )
    return await asyncio.to_thread(_run, env, service, category)
