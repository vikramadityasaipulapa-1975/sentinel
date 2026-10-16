"""Bounded ASGI request buffering and allowlisted completion logs."""

import json
import time
from datetime import UTC, datetime
from uuid import UUID, uuid4

from starlette.responses import JSONResponse


def emit(record: dict) -> None:
    print(json.dumps(record, separators=(",", ":")), flush=True)


def error_response(request_id: str, status: int, code: str, message: str):
    return JSONResponse(
        {"error": {"code": code, "message": message}, "request_id": request_id},
        status_code=status,
        headers={"x-request-id": request_id},
    )


class RequestContext:
    def __init__(self, app, sink=emit):
        self.app = app
        self.sink = sink

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        try:
            raw = headers.get(b"x-request-id", b"").decode("ascii")
            request_id = str(UUID(raw)) if len(raw) == 36 else str(uuid4())
        except (ValueError, UnicodeError):
            request_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        start = time.perf_counter()
        status = 500
        started = False

        async def send_with_id(message):
            nonlocal status, started
            if message["type"] == "http.response.start":
                status = message["status"]
                started = True
                message["headers"] = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() != b"x-request-id"
                ] + [(b"x-request-id", request_id.encode("ascii"))]
            await send(message)

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
            route = scope.get("path")
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
