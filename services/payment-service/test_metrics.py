"""Real ASGI requests and Prometheus exposition; payments remain simulated."""

from config import Settings
from fastapi.testclient import TestClient
from main import create_app
from prometheus_client.parser import text_string_to_metric_families

PAYMENT = {
    "order_id": "11111111-1111-4111-8111-111111111111",
    "amount_minor": 12500,
    "currency": "INR",
}


def sample(text, name, **labels):
    for family in text_string_to_metric_families(text):
        for value in family.samples:
            if value.name == name and all(
                value.labels.get(key) == expected for key, expected in labels.items()
            ):
                return value.value
    raise AssertionError(f"Missing {name} sample")


def test_payment_metrics_count_success_errors_and_scrapes_without_private_labels():
    with TestClient(create_app(sink=lambda _: None, settings=Settings())) as client:
        assert client.post("/payments", json=PAYMENT).status_code == 201
        assert client.post("/payments", json={}).status_code == 422
        assert client.post("/payments", content=b"x" * 8193).status_code == 413
        for suffix in ["private-id-a", "private-id-b"]:
            assert (
                client.get(f"/missing/{suffix}?token=never-label-this").status_code
                == 404
            )
        response = client.get("/metrics")
        assert response.status_code == 200
        assert "text/plain" in response.headers["content-type"]
        text = response.text
        good = dict(
            service="payment-service",
            method="POST",
            route="/payments",
            status_code="201",
        )
        assert sample(text, "sentinel_http_requests_total", **good) == 1
        assert sample(text, "sentinel_http_request_duration_seconds_count", **good) == 1
        assert (
            sample(
                text, "sentinel_http_request_duration_seconds_bucket", **good, le="+Inf"
            )
            == 1
        )
        assert (
            sample(
                text,
                "sentinel_http_requests_total",
                route="/payments",
                status_code="422",
            )
            == 1
        )
        assert (
            sample(
                text,
                "sentinel_http_requests_total",
                route="unmatched",
                status_code="413",
            )
            == 1
        )
        assert (
            sample(
                text,
                "sentinel_http_requests_total",
                route="unmatched",
                status_code="404",
            )
            == 2
        )
        assert not any(
            value in text
            for value in ["private-id", "never-label-this", "request_id", "order_id"]
        )
        assert client.get("/metrics").text == text


def test_payment_metrics_include_fault_delay_and_fault_status():
    with TestClient(
        create_app(
            sink=lambda _: None,
            settings=Settings(fault_mode="latency", fault_delay_ms=80),
        )
    ) as client:
        assert client.post("/payments", json=PAYMENT).status_code == 201
        assert (
            sample(
                client.get("/metrics").text,
                "sentinel_http_request_duration_seconds_sum",
                route="/payments",
                status_code="201",
            )
            >= 0.06
        )
    with TestClient(
        create_app(sink=lambda _: None, settings=Settings(fault_mode="error"))
    ) as client:
        assert client.post("/payments", json=PAYMENT).status_code == 503
        assert (
            sample(
                client.get("/metrics").text,
                "sentinel_http_requests_total",
                route="/payments",
                status_code="503",
            )
            == 1
        )


def test_payment_metrics_are_isolated_per_app():
    with (
        TestClient(create_app(sink=lambda _: None, settings=Settings())) as one,
        TestClient(create_app(sink=lambda _: None, settings=Settings())) as two,
    ):
        one.get("/health")
        assert 'route="/health"' in one.get("/metrics").text
        assert 'route="/health"' not in two.get("/metrics").text
