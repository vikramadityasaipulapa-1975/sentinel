import asyncio

import pytest
from evidence.models import result
from test_prometheus import window
from workflow import extract_facts, run_sequential


def fixture_tools(win, order=None):
    start = win.start.timestamp()
    points = [[start + i * 15, 0 if i < 10 else 0.5] for i in range(20)]
    values = {
        "prometheus": result(
            "prometheus",
            win,
            {"kind": "fixture"},
            series={
                key: points for key in ("error_ratio", "request_rate", "p95_seconds")
            },
        ),
        "loki": result(
            "loki",
            win,
            {"kind": "fixture"},
            retrieved_count=2,
            counts_by_status={"504": 2},
        ),
        "deployments": result(
            "deployments",
            win,
            {"kind": "fixture"},
            "EMPTY",
            releases=[],
            verified_release_count=0,
        ),
    }

    def tool(name):
        async def call(value):
            assert value == win
            if order is not None:
                order.append(name)
            return values[name]

        return call

    return {name: tool(name) for name in values}


def test_sequential_order_and_no_invented_deployment():
    order = []
    win = window()
    state = asyncio.run(run_sequential(win, fixture_tools(win, order)))
    assert order == ["prometheus", "loki", "deployments"]
    assert state.status == "PARTIAL" and state.model.status == "DISABLED"
    assert state.stages == (
        "validate",
        "collect",
        "calculate",
        "analyze",
        "validate-report",
    )
    assert "deployments.verified" not in {fact.id for fact in state.facts}


def test_source_failure_preserves_other_evidence_and_never_makes_zero():
    win = window()
    tools = fixture_tools(win)

    async def broken(_):
        raise ConnectionError("fixture unavailable")

    tools["prometheus"] = broken
    state = asyncio.run(run_sequential(win, tools))
    assert state.evidence[0].status == "UNAVAILABLE"
    assert state.evidence[1].data["retrieved_count"] == 2
    assert not any(
        fact.id.startswith("metrics.") for fact in extract_facts(state.evidence)
    )


def test_invalid_window_runs_no_tools():
    win = window()
    with pytest.raises(ValueError):
        asyncio.run(
            run_sequential(
                win.model_copy(update={"service": "unknown"}), fixture_tools(win)
            )
        )
