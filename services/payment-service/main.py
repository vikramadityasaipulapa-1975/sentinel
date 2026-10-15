"""Local demo payment API. No real money or persistent records."""

from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from models import PaymentRequest, PaymentResponse
from observability import RequestContext, emit, error_response
from starlette.exceptions import HTTPException


def create_app(sink=emit) -> FastAPI:
    app = FastAPI(title="Sentinel demo payment service", version="0.1.0")
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

    @app.post("/payments", response_model=PaymentResponse, status_code=201)
    async def create_payment(payment: PaymentRequest) -> PaymentResponse:
        # Simulation only: no gateway, database, or actual money movement.
        return PaymentResponse(
            **payment.model_dump(), payment_id=uuid4(), status="succeeded"
        )

    return app


app = create_app()
