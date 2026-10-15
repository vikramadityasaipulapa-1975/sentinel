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
