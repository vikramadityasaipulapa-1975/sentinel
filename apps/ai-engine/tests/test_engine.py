import asyncio

import httpx
from engine import create_app
from test_prometheus import window


def run(check):
    app = create_app(
        {
            "SENTINEL_EVIDENCE_SECRET": "a" * 64,
            "SENTINEL_PROMETHEUS_URL": "http://127.0.0.1:1",
            "SENTINEL_LOKI_URL": "http://127.0.0.1:1",
            "SENTINEL_DEPLOYMENT_READ_URL": "postgresql://reader:fake@127.0.0.1:1/demo",
        }
    )

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://engine.test"
        ) as client:
            await check(client)

    asyncio.run(exercise())


def test_health_no_ai_and_collection_requires_auth():
    async def check(value):
        assert (await value.get("/health")).json()["ai_performed"] is False
        assert (
            await value.post("/collect", json=window().model_dump(mode="json"))
        ).status_code == 401

    run(check)


def test_rejects_arbitrary_queries_and_oversized_body():
    async def check(value):
        headers = {"authorization": "Bearer " + "a" * 64}
        assert (
            await value.post("/collect", headers=headers, json={"query": "anything"})
        ).status_code == 422
        assert (
            await value.post("/collect", headers=headers, content="x" * 2049)
        ).status_code == 413

    run(check)
