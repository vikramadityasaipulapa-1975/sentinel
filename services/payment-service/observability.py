"""Bounded ASGI request buffering and allowlisted completion logs."""

import json
import time
from datetime import UTC, datetime
from uuid import UUID, uuid4

from opentelemetry.trace import Status, StatusCode
from starlette.responses import JSONResponse
from tracing import create_tracer, server_span


def emit(record: dict) -> None:
    print(json.dumps(record, separators=(",", ":")), flush=True)


def error_response(request_id: str, status: int, code: str, message: str):
    return JSONResponse(
        {"error": {"code": code, "message": message}, "request_id": request_id},
        status_code=status,
        headers={"x-request-id": request_id},
    )


class RequestContext:
    def __init__(self, app, sink=emit, metrics=None):
        self.app = app
        self.sink = sink
        self.metrics = metrics
        self.tracer = create_tracer()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        span = (
            server_span(self.tracer, headers)
            if self.tracer and scope.get("path") == "/payments"
            else None
        )
        try:
            raw = headers.get(b"x-request-id", b"").decode("ascii")
            request_id = str(UUID(raw)) if len(raw) == 36 else str(uuid4())
        except (ValueError, UnicodeError):
            request_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        start = time.perf_counter()
        status = 500
        started = False
        completed = False

        async def send_with_id(message):
            nonlocal status, started, completed
            if message["type"] == "http.response.start":
                status = message["status"]
                started = True
                message["headers"] = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"x-request-id"
                ] + [(b"x-request-id", request_id.encode("ascii"))]
            await send(message)
            if message["type"] == "http.response.body" and not message.get(
                "more_body", False
            ):
                completed = True

        try:
            # Bound actual bytes, including chunked requests with no Content-Length.
            body = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    status = 499
                    return
                body.extend(message.get("body", b""))
                if len(body) > 8192:
                    await error_response(
                        request_id, 413, "PAYLOAD_TOO_LARGE", "Request body too large"
                    )(scope, receive, send_with_id)
                    return
                if not message.get("more_body", False):
                    break
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {
                        "type": "http.request",
                        "body": bytes(body),
                        "more_body": False,
                    }
                return await receive()

            await self.app(scope, replay, send_with_id)
        except Exception:
            if not started:
                await error_response(
                    request_id, 500, "INTERNAL_ERROR", "Unexpected server error"
                )(scope, receive, send_with_id)
            else:
                raise
        finally:
            if span:
                span.set_attribute("http.response.status_code", status)
                if status >= 500:
                    span.set_status(Status(StatusCode.ERROR))
                span.end()
            route = scope.get("path")
            if self.metrics is not None and route != "/metrics" and completed:
                # Match the endpoint template, never an attacker-controlled raw URL.
                template = getattr(scope.get("route"), "path", "unmatched")
                self.metrics.observe(
                    scope.get("method", "OTHER"),
                    template,
                    status,
                    time.perf_counter() - start,
                )
            self.sink(
                {
                    "timestamp": datetime.now(UTC).isoformat(),
                    "level": "error"
                    if status >= 500
                    else "warn"
                    if status >= 400
                    else "info",
                    "service": "payment-service",
                    "event": "request_completed",
                    "request_id": request_id,
                    **(
                        {"trace_id": format(span.get_span_context().trace_id, "032x")}
                        if span
                        else {}
                    ),
                    "route": route
                    if route
                    in {
                        "/health",
                        "/ready",
                        "/version",
                        "/payments",
                        "/docs",
                        "/openapi.json",
                    }
                    else "unmatched",
                    "status": status,
                    "duration_ms": round((time.perf_counter() - start) * 1000, 2),
                }
            )
