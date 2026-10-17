import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from tracing import create_tracer, server_span


def test_payment_traceparent_is_connected_and_malformed_context_is_ignored():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("verification")
    try:
        span = server_span(
            tracer,
            {
                b"traceparent": b"00-11111111111111111111111111111111-2222222222222222-01"
            },
        )
        span.end()
        linked = exporter.get_finished_spans()[0]
        assert linked.context.trace_id == int("1" * 32, 16)
        assert linked.parent.span_id == int("2" * 16, 16)
        bad = server_span(
            tracer,
            {b"traceparent": b"secret-not-a-trace", b"baggage": b"password=never-copy"},
        )
        bad.end()
        finished = exporter.get_finished_spans()[1]
        assert finished.parent is None
        assert "password" not in str(finished.attributes)
    finally:
        provider.shutdown()


def test_tracing_configuration_rejects_remote_or_credentialed_destinations(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", raising=False)
    assert create_tracer() is None
    for endpoint in [
        "http://example.com/v1/traces",
        "http://user:password@localhost:4418/v1/traces",
        "http://localhost:4418/v1/traces?secret=bad",
    ]:
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", endpoint)
        with pytest.raises(ValueError):
            create_tracer()
