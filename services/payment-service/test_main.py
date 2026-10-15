import time
from uuid import UUID

import pytest
from config import Settings
from fastapi.testclient import TestClient
from main import create_app

VALID_PAYMENT = {
    "order_id": "11111111-1111-4111-8111-111111111111",
    "amount_minor": 12500,
    "currency": "INR",
}


@pytest.fixture(autouse=True)
def isolated_fault_environment(monkeypatch):
    monkeypatch.delenv("PAYMENT_FAULT_MODE", raising=False)
    monkeypatch.delenv("PAYMENT_FAULT_DELAY_MS", raising=False)


def test_health():
    with TestClient(create_app()) as client:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "service": "payment-service"}


def test_openapi():
    with TestClient(create_app()) as client:
        response = client.get("/openapi.json")
        assert response.status_code == 200
        assert "/health" in response.json()["paths"]
        assert client.get("/docs").status_code == 200
        error_schema = response.json()["paths"]["/payments"]["post"]["responses"][
            "422"
        ]["content"]["application/json"]["schema"]
        assert error_schema["$ref"].endswith("/ErrorResponse")


def test_unknown_route():
    with TestClient(create_app()) as client:
        assert client.get("/unknown").status_code == 404


def test_valid_payment():
    with TestClient(create_app()) as client:
        response = client.post("/payments", json=VALID_PAYMENT)
        assert response.status_code == 201
        body = response.json()
        assert UUID(body["payment_id"])
        assert body == {
            **VALID_PAYMENT,
            "payment_id": body["payment_id"],
            "status": "succeeded",
        }
        assert "/payments" in client.get("/openapi.json").json()["paths"]


@pytest.mark.parametrize(
    "patch",
    [
        {"amount_minor": 0},
        {"amount_minor": -1},
        {"amount_minor": "12500"},
        {"amount_minor": True},
        {"amount_minor": 1.5},
        {"amount_minor": 100_000_001},
        {"order_id": "bad-uuid"},
        {"currency": "EUR"},
        {"card_number": "fake-do-not-log"},
    ],
)
def test_invalid_payment(patch):
    with TestClient(create_app()) as client:
        assert (
            client.post("/payments", json={**VALID_PAYMENT, **patch}).status_code == 422
        )


def test_missing_payment_fields():
    with TestClient(create_app()) as client:
        assert client.post("/payments", json={}).status_code == 422


def test_request_ids_and_safe_logs():
    records = []
    request_id = "33333333-3333-4333-8333-333333333333"
    with TestClient(create_app(sink=records.append)) as client:
        response = client.get(
            "/health?secret=secret-marker",
            headers={"x-request-id": request_id, "authorization": "secret-marker"},
        )
        assert response.headers["x-request-id"] == request_id
        for body, status in [
            ("{secret-marker", 422),
            ('{"secret":"secret-marker"}', 422),
            ("x" * 9000, 413),
        ]:
            response = client.post(
                "/payments",
                content=body,
                headers={
                    "content-type": "application/json",
                    "x-request-id": "secret-marker",
                },
            )
            assert response.status_code == status
            assert UUID(response.json()["request_id"])
            assert response.json()["request_id"] == response.headers["x-request-id"]
            assert "secret-marker" not in response.text
    assert len(records) == 4
    assert records[0]["request_id"] == request_id
    assert "secret-marker" not in str(records)


def test_chunked_body_is_bounded():
    with TestClient(create_app()) as client:
        response = client.post(
            "/payments",
            content=iter([b"x" * 5000, b"x" * 5000]),
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 413


def test_unexpected_error_is_safe():
    app = create_app()

    @app.get("/test-error")
    async def broken():
        raise RuntimeError("secret-marker")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/test-error")
        assert response.status_code == 500
        assert "secret-marker" not in response.text
        assert UUID(response.json()["request_id"])


def test_faults_disabled_by_default(monkeypatch):
    monkeypatch.delenv("PAYMENT_FAULT_MODE", raising=False)
    monkeypatch.delenv("PAYMENT_FAULT_DELAY_MS", raising=False)
    assert Settings.from_env() == Settings()
    with TestClient(create_app()) as client:
        for _ in range(3):
            assert client.post("/payments", json=VALID_PAYMENT).status_code == 201


def test_error_fault_is_repeatable_and_health_stays_up():
    records = []
    with TestClient(
        create_app(sink=records.append, settings=Settings("error"))
    ) as client:
        assert client.get("/health").status_code == 200
        for _ in range(3):
            assert client.post("/payments", json=VALID_PAYMENT).status_code == 503
    assert len([r for r in records if r["event"] == "fault_injected"]) == 3


def test_latency_fault_and_invalid_settings():
    with TestClient(create_app(settings=Settings("latency", 80))) as client:
        start = time.perf_counter()
        assert client.post("/payments", json=VALID_PAYMENT).status_code == 201
        assert time.perf_counter() - start >= 0.07
    for mode, delay in [
        ("typo", 500),
        ("latency", 0),
        ("latency", 5001),
        ("latency", True),
    ]:
        with pytest.raises(ValueError):
            Settings(mode, delay)


def test_request_cannot_activate_faults():
    with TestClient(create_app(settings=Settings())) as client:
        assert (
            client.post(
                "/payments?fault=error",
                json=VALID_PAYMENT,
                headers={"x-fault-mode": "error"},
            ).status_code
            == 201
        )
        assert (
            client.post(
                "/payments", json={**VALID_PAYMENT, "fault_mode": "error"}
            ).status_code
            == 422
        )


def test_fault_environment_is_validated(monkeypatch):
    monkeypatch.setenv("PAYMENT_FAULT_MODE", "error")
    assert Settings.from_env().fault_mode == "error"
    monkeypatch.setenv("PAYMENT_FAULT_DELAY_MS", "secret-marker")
    with pytest.raises(ValueError) as error:
        Settings.from_env()
    assert "secret-marker" not in str(error.value)
