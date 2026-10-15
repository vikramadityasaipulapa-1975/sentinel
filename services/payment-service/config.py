"""Startup-only demo fault settings; no request can enable a fault."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    fault_mode: str = "normal"
    fault_delay_ms: int = 500

    def __post_init__(self):
        if self.fault_mode not in {"normal", "latency", "error"}:
            raise ValueError("PAYMENT_FAULT_MODE must be normal, latency, or error")
        if type(self.fault_delay_ms) is not int or not 1 <= self.fault_delay_ms <= 5000:
            raise ValueError("PAYMENT_FAULT_DELAY_MS must be from 1 to 5000")

    @classmethod
    def from_env(cls):
        try:
            delay = int(os.getenv("PAYMENT_FAULT_DELAY_MS", "500"))
        except ValueError:
            raise ValueError("PAYMENT_FAULT_DELAY_MS must be from 1 to 5000") from None
        return cls(
            fault_mode=os.getenv("PAYMENT_FAULT_MODE", "normal"),
            fault_delay_ms=delay,
        )
