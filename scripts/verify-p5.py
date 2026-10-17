"""Read-only live evidence checks. Fixtures are separately labelled unit tests."""

import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone

import httpx
from local_support import ROOT

sys.path.insert(0, str(ROOT / "apps/ai-engine"))
from evidence.models import Window  # noqa: E402
from evidence.prometheus import query_prometheus  # noqa: E402


async def main():
    end = datetime.now(timezone.utc)
    window = Window(
        service="checkout-service", start=end - timedelta(minutes=5), end=end
    )
    async with httpx.AsyncClient() as client:
        value = await query_prometheus(client, "http://127.0.0.1:9090", window)
        assert value.status in {"OK", "PARTIAL"}, value.status
        assert value.data["series"]["request_rate"], "No real request-rate samples"
        missing = await query_prometheus(client, "http://127.0.0.1:1", window)
        assert missing.status == "UNAVAILABLE"
    report = {
        "at": end.isoformat(),
        "prometheus": value.model_dump(mode="json"),
        "negative": missing.status,
        "data_kind": "live local collectors",
    }
    output = ROOT / ".artifacts/p5-verification.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("P5.1 live metrics and unreachable-source checks passed; report:", output)


if __name__ == "__main__":
    asyncio.run(main())
