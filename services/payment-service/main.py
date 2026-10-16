"""Local demo payment API. No real money or persistent records."""

import asyncio
from datetime import UTC, datetime
from uuid import UUID

import psycopg
from config import Settings
from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from models import ErrorResponse, PaymentRequest, PaymentResponse
from observability import RequestContext, emit, error_response
from starlette.exceptions import HTTPException
from store import MemoryStore, PaymentConflict, PostgresStore


def create_app(sink=emit, settings: Settings | None = None, store=None) -> FastAPI:
    settings = settings if settings is not None else Settings.from_env()
    store = (
        store
        if store is not None
        else PostgresStore(settings.database_url)
        if settings.storage_mode == "postgres"
        else MemoryStore()
    )
    app = FastAPI(
        title="Sentinel demo payment service",
        version="0.1.0",
        responses={
            code: {"model": ErrorResponse} for code in (404, 409, 413, 422, 500, 503)
        },
    )
    app.add_middleware(RequestContext, sink=sink)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, _error):
        return error_response(
            request.state.request_id, 422, "INVALID_PAYMENT", "Invalid payment fields"
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error):
        return error_response(
            request.state.request_id,
            error.status_code,
            "HTTP_ERROR",
            "Request could not be handled",
        )

    @app.exception_handler(Exception)
    async def internal_error(request: Request, _error):
        return error_response(
            request.state.request_id, 500, "INTERNAL_ERROR", "Unexpected server error"
        )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "payment-service"}

    @app.get("/version")
    async def version():
        return {
            "service": "payment-service",
            "version": settings.version,
            "source_sha256": settings.source_sha256,
            "commit_sha": settings.commit_sha,
            "deployment_id": settings.deployment_id,
            "fault_mode": settings.fault_mode,
        }

    @app.get("/ready")
    async def ready(request: Request):
        try:
            if not await asyncio.to_thread(store.ready):
                raise RuntimeError("Schema unavailable")
        except Exception:
            return error_response(
                request.state.request_id, 503, "NOT_READY", "Storage is not ready"
            )
        return {"status": "ready", "storage": settings.storage_mode}

    @app.post(
        "/payments",
        response_model=PaymentResponse,
        status_code=201,
        responses={
            503: {"description": "Injected local demo fault", "model": ErrorResponse}
        },
    )
    async def create_payment(
        payment: PaymentRequest,
        request: Request,
        idempotency_key: str | None = Header(default=None),
    ):
        raw_key = (
            idempotency_key if idempotency_key is not None else str(payment.order_id)
        )
        try:
            if len(raw_key) != 36:
                raise ValueError()
            key = UUID(raw_key)
        except ValueError:
            return error_response(
                request.state.request_id,
                422,
                "INVALID_IDEMPOTENCY_KEY",
                "Idempotency-Key must be a UUID",
            )
        if settings.fault_mode != "normal":
            sink(
                {
                    "timestamp": datetime.now(UTC).isoformat(),
                    "level": "warn",
                    "service": "payment-service",
                    "event": "fault_injected",
                    "request_id": request.state.request_id,
                    "fault_mode": settings.fault_mode,
                    "delay_ms": settings.fault_delay_ms
                    if settings.fault_mode == "latency"
                    else 0,
                }
            )
        if settings.fault_mode == "error":
            return error_response(
                request.state.request_id,
                503,
                "PAYMENT_FAULT",
                "Injected local payment failure",
            )
        if settings.fault_mode == "latency":
            await asyncio.sleep(settings.fault_delay_ms / 1000)
        try:
            return await asyncio.to_thread(store.save, payment, key)
        except PaymentConflict as error:
            return error_response(
                request.state.request_id,
                409,
                error.code,
                "Payment request conflicts with a previous request",
            )
        except psycopg.Error:
            return error_response(
                request.state.request_id,
                503,
                "STORAGE_UNAVAILABLE",
                "Payment storage is unavailable",
            )

    return app


app = create_app()
