"""Explicit bounded demo tracing; no baggage, bodies, query strings or secrets."""

import os
from urllib.parse import urlsplit

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.propagate import extract
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind


def create_tracer():
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    if not endpoint:
        return None
    url = urlsplit(endpoint)
    if (
        url.scheme != "http"
        or url.hostname not in {"127.0.0.1", "localhost"}
        or url.port != 4418
        or url.path != "/v1/traces"
        or url.query
        or url.fragment
        or url.username
        or url.password
    ):
        raise ValueError("Tracing endpoint must be the fixed local OTLP HTTP receiver")
    provider = TracerProvider(
        resource=Resource.create({"service.name": "payment-service"})
    )
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(endpoint=endpoint, timeout=1),
            max_queue_size=256,
            max_export_batch_size=64,
            schedule_delay_millis=500,
            export_timeout_millis=1500,
        )
    )
    return provider.get_tracer("sentinel-demo")


def server_span(tracer, headers):
    # Accept only traceparent from the internal checkout hop, never arbitrary baggage.
    raw = headers.get(b"traceparent", b"")
    carrier = (
        {"traceparent": raw.decode("ascii", errors="ignore")} if len(raw) <= 128 else {}
    )
    return tracer.start_span(
        "POST /payments", context=extract(carrier), kind=SpanKind.SERVER
    )
