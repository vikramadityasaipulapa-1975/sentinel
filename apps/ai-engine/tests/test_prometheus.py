import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from evidence.models import Window
from evidence.prometheus import query_prometheus


def window():
    end = datetime.now(timezone.utc)
    return Window(service="checkout-service", start=end - timedelta(minutes=5), end=end)


def run(body):
    async def check():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))
        ) as client:
            return await query_prometheus(client, "http://localhost:9090", window())

    return asyncio.run(check())


def test_normalizes_and_records_locator():
    stamp = datetime.now(timezone.utc).timestamp() - 20
    value = run(
        {
            "status": "success",
            "data": {"resultType": "matrix", "result": [{"values": [[stamp, "1.5"]]}]},
        }
    )
    assert value.status == "OK"
    assert value.data["series"]["request_rate"] == [[stamp, 1.5]]
    assert value.locator["url"].endswith("/api/v1/query_range")


def test_nonfinite_not_zero():
    stamp = datetime.now(timezone.utc).timestamp() - 20
    value = run(
        {
            "status": "success",
            "data": {"resultType": "matrix", "result": [{"values": [[stamp, "NaN"]]}]},
        }
    )
    assert value.status == "PARTIAL"
    assert value.data["series"]["request_rate"] == []


def test_empty_and_malformed():
    assert (
        run(
            {"status": "success", "data": {"resultType": "matrix", "result": []}}
        ).status
        == "EMPTY"
    )
    assert run({"status": "error"}).status == "INVALID"


def test_disallows_unbounded_or_unknown_input():
    with pytest.raises(ValueError):
        Window(service="anything", start=datetime.now(), end=datetime.now())
