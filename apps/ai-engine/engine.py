"""Internal authenticated evidence collector; no primary database write access."""

import asyncio
import hmac
import os

import httpx
from evidence.calculations import compare_metrics
from evidence.deployments import query_deployments, validate_dsn
from evidence.http import endpoint
from evidence.loki import search_loki
from evidence.models import Window
from evidence.prometheus import query_prometheus
from fastapi import FastAPI, Request
from pydantic import ValidationError
from starlette.responses import JSONResponse


def create_app(settings=None, transport=None):
    env = settings if settings is not None else os.environ
    secret = env.get("SENTINEL_EVIDENCE_SECRET", "")
    if len(secret) < 64 or not all(c in "0123456789abcdef" for c in secret):
        raise ValueError("Evidence secret must be at least 32 random bytes as hex")
    prom = endpoint(env.get("SENTINEL_PROMETHEUS_URL", ""))
    loki = endpoint(env.get("SENTINEL_LOKI_URL", ""))
    dsn = env.get("SENTINEL_DEPLOYMENT_READ_URL", "")
    validate_dsn(dsn)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    active = 0

    @app.get("/health")
    async def health():
        return {"service": "sentinel-evidence", "status": "ok", "ai_performed": False}

    @app.post("/collect")
    async def collect(request: Request):
        nonlocal active
        token = request.headers.get("authorization", "")
        if len(token) > 256 or not hmac.compare_digest(
            token.encode("utf-8"), ("Bearer " + secret).encode("utf-8")
        ):
            return JSONResponse({"error": "UNAUTHORIZED"}, status_code=401)
        if active >= 2:
            return JSONResponse({"error": "BUSY"}, status_code=503)
        active += 1
        try:
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 2048:
                    return JSONResponse({"error": "TOO_LARGE"}, status_code=413)
            try:
                window = Window.model_validate_json(raw)
            except ValidationError:
                return JSONResponse({"error": "INVALID_WINDOW"}, status_code=422)
            async with httpx.AsyncClient(
                transport=transport, trust_env=False
            ) as client:
                metrics, logs, releases = await asyncio.wait_for(
                    asyncio.gather(
                        query_prometheus(client, prom, window),
                        search_loki(client, loki, window),
                        query_deployments(dsn, window),
                    ),
                    3,
                )
            calculations = compare_metrics(metrics, logs)
            return {
                "mode": "deterministic-evidence",
                "ai_performed": False,
                "evidence": [
                    item.model_dump(mode="json")
                    for item in (metrics, logs, releases, calculations)
                ],
            }
        except (asyncio.TimeoutError, ValueError):
            return JSONResponse({"error": "COLLECTION_FAILED"}, status_code=503)
        finally:
            active -= 1

    return app
