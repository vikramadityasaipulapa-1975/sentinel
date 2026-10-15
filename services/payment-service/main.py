"""Local demo payment API. No real money or persistent records."""

from uuid import uuid4

from fastapi import FastAPI
from models import PaymentRequest, PaymentResponse


def create_app() -> FastAPI:
    app = FastAPI(title="Sentinel demo payment service", version="0.1.0")

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
