from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from config import Settings
from fastapi.testclient import TestClient
from main import create_app
from models import PaymentRequest
from store import MemoryStore, PaymentConflict


def payment():
    return PaymentRequest(order_id=uuid4(), amount_minor=12500, currency="INR")


def test_memory_replay_and_concurrent_requests():
    store = MemoryStore()
    request, key = payment(), uuid4()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: store.save(request, key), range(16)))
    assert len({row.payment_id for row in results}) == 1
    assert len(store.by_order) == 1
    assert len(store.by_key) == 1


def test_key_and_order_conflicts():
    store = MemoryStore()
    request, key = payment(), uuid4()
    store.save(request, key)
    with pytest.raises(PaymentConflict):
        store.save(request.model_copy(update={"amount_minor": 1}), key)
    with pytest.raises(PaymentConflict):
        store.save(payment(), key)
    with pytest.raises(PaymentConflict):
        store.save(request, uuid4())


def test_http_key_contract_and_readiness():
    with TestClient(create_app(settings=Settings())) as client:
        request = payment().model_dump(mode="json")
        key = str(uuid4())
        first = client.post("/payments", json=request, headers={"Idempotency-Key": key})
        replay = client.post(
            "/payments", json=request, headers={"Idempotency-Key": key}
        )
        assert first.status_code == replay.status_code == 201
        assert first.json() == replay.json()
        assert (
            client.post(
                "/payments",
                json={**request, "amount_minor": 1},
                headers={"Idempotency-Key": key},
            ).status_code
            == 409
        )
        assert (
            client.post(
                "/payments", json=request, headers={"Idempotency-Key": "bad"}
            ).status_code
            == 422
        )
        assert client.get("/ready").json() == {"status": "ready", "storage": "memory"}


def test_postgres_configuration_never_silently_falls_back():
    with pytest.raises(ValueError):
        Settings(storage_mode="postgres")
    with pytest.raises(ValueError):
        Settings(storage_mode="postgres", database_url="postgresql://example.com/demo")
    with pytest.raises(ValueError):
        Settings(storage_mode="typo")
    with pytest.raises(ValueError):
        Settings(
            storage_mode="postgres",
            database_url="postgresql://sentinel@127.0.0.1/sentinel?hostaddr=192.0.2.1",
        )


def test_version_profile_and_metadata(monkeypatch):
    monkeypatch.setenv("PAYMENT_VERSION", "payment-v3-error")
    settings = Settings.from_env()
    assert settings.fault_mode == "error"
    with TestClient(create_app(settings=settings)) as client:
        metadata = client.get("/version").json()
        assert metadata["version"] == "payment-v3-error"
        assert metadata["commit_sha"] == "unknown"
        assert metadata["deployment_id"] == "unregistered"
    monkeypatch.setenv("PAYMENT_VERSION", "shell-command-is-not-a-version")
    with pytest.raises(ValueError):
        Settings.from_env()
    with pytest.raises(ValueError):
        Settings(version="payment-v3-error", fault_mode="normal")
