from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from main import create_app

VALID_PAYMENT = {
    "order_id": "11111111-1111-4111-8111-111111111111",
    "amount_minor": 12500,
    "currency": "INR",
}


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
