"""Read-only live workflow verification; no model request or remediation."""

import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone

import httpx
from local_support import ROOT

sys.path.insert(0, str(ROOT / "apps/ai-engine"))
from evidence.deployments import query_deployments  # noqa: E402
from evidence.loki import search_loki  # noqa: E402
from evidence.models import Window  # noqa: E402
from evidence.prometheus import query_prometheus  # noqa: E402
from workflow import run_sequential  # noqa: E402


async def main():
    settings = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.evidence").read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#")
    )
    end = datetime.now(timezone.utc)
    window = Window(
        service="checkout-service", start=end - timedelta(minutes=5), end=end
    )
    async with httpx.AsyncClient(trust_env=False) as client:
        tools = {
            "prometheus": lambda win: query_prometheus(
                client, settings["SENTINEL_PROMETHEUS_URL"], win
            ),
            "loki": lambda win: search_loki(client, settings["SENTINEL_LOKI_URL"], win),
            "deployments": lambda win: query_deployments(
                settings["SENTINEL_DEPLOYMENT_READ_URL"], win
            ),
        }
        state = await run_sequential(window, tools)
    assert len(state.evidence) == 4
    assert state.evidence[0].status in {"OK", "PARTIAL"}
    assert state.model.status == "DISABLED" and not state.model.ai_performed
    report = {
        "at": end.isoformat(),
        "data_kind": "live local telemetry; no model inference",
        "status": state.status,
        "stages": state.stages,
        "source_statuses": {row.source: row.status for row in state.evidence},
        "fact_count": len(state.facts),
    }
    (ROOT / ".artifacts/p6-workflow-verification.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print("P6 live sequential workflow passed; model disabled; report in .artifacts")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
