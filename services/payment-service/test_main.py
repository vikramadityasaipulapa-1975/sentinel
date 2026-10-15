from fastapi.testclient import TestClient
from main import create_app


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
