"""Per-application Prometheus registry with bounded HTTP dimensions."""

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
)
from starlette.responses import Response


class HttpMetrics:
    def __init__(self):
        self.registry = CollectorRegistry()
        labels = ("service", "method", "route", "status_code")
        self.requests = Counter(
            "sentinel_http_requests_total",
            "Completed HTTP responses, excluding metrics scrapes",
            labels,
            registry=self.registry,
        )
        self.duration = Histogram(
            "sentinel_http_request_duration_seconds",
            "Time from request middleware entry to response completion in seconds",
            labels,
            buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10),
            registry=self.registry,
        )

    def observe(self, method: str, route: str, status: int, seconds: float):
        method = (
            method
            if method in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
            else "OTHER"
        )
        route = (
            route
            if route
            in {
                "/health",
                "/ready",
                "/version",
                "/payments",
                "/docs",
                "/docs/oauth2-redirect",
                "/redoc",
                "/openapi.json",
            }
            else "unmatched"
        )
        values = ("payment-service", method, route, str(status))
        self.requests.labels(*values).inc()
        self.duration.labels(*values).observe(seconds)

    def response(self):
        return Response(
            generate_latest(self.registry),
            headers={"content-type": CONTENT_TYPE_LATEST, "cache-control": "no-store"},
        )
