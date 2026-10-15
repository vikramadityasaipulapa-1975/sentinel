"""Public demo contract: amounts are integer minor units, never card data."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PaymentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    order_id: UUID
    amount_minor: int = Field(strict=True, gt=0, le=100_000_000)
    currency: Literal["INR", "USD"]


class PaymentResponse(PaymentRequest):
    payment_id: UUID
    status: Literal["succeeded"]
