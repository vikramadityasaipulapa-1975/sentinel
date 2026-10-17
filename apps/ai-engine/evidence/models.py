from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

Service = Literal["checkout-service", "payment-service"]
Status = Literal["OK", "EMPTY", "UNAVAILABLE", "INVALID", "PARTIAL", "STALE"]


class Window(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    service: Service
    start: datetime
    end: datetime

    @model_validator(mode="after")
    def bounded(self):
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise ValueError("Timezone is required")
        if not 0 < (self.end - self.start).total_seconds() <= 1800:
            raise ValueError("Window must be positive and at most 30 minutes")
        if self.end.timestamp() > datetime.now(timezone.utc).timestamp() + 5:
            raise ValueError("Future window is not allowed")
        return self


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["prometheus", "loki", "deployments", "calculations"]
    status: Status
    window: Window
    collected_at: datetime
    locator: dict
    data: dict


def result(source, window, locator, status="OK", **data):
    return Evidence(
        source=source,
        status=status,
        window=window,
        collected_at=datetime.now(timezone.utc),
        locator=locator,
        data=data,
    )
