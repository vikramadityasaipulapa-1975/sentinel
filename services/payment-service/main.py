"""Local demo payment API. No real money or persistent records."""

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from config import Settings
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from models import ErrorResponse, PaymentRequest, PaymentResponse
from observability import RequestContext, emit, error_response
from starlette.exceptions import HTTPException


def create_app(sink=emit, settings: Settings | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings.from_env()
    app = FastAPI(
        title="Sentinel demo payment service",
        version="0.1.0",
        responses={code: {"model": ErrorResponse} for code in (404, 413, 422, 500)},
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

    @app.post(
        "/payments",
        response_model=PaymentResponse,
        status_code=201,
        responses={
            503: {"description": "Injected local demo fault", "model": ErrorResponse}
        },
    )
    async def create_payment(payment: PaymentRequest, request: Request):
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
        # Simulation only: no gateway, database, or actual money movement.
        return PaymentResponse(
            **payment.model_dump(), payment_id=uuid4(), status="succeeded"
        )

    return app


app = create_app()
