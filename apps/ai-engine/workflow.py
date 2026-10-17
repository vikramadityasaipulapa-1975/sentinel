"""Deterministic workflow stages with isolated read-only source failures."""

import asyncio
import math
from dataclasses import dataclass
from typing import Awaitable, Callable

from evidence.calculations import compare_metrics
from evidence.models import Evidence, Window, result
from hypothesis import Fact
from llm_adapter import DisabledAdapter, ModelAdapter, ModelResult

Tool = Callable[[Window], Awaitable[Evidence]]
SOURCES = ("prometheus", "loki", "deployments")


@dataclass(frozen=True)
class InvestigationState:
    evidence: list[Evidence]
    facts: list[Fact]
    model: ModelResult
    stages: tuple[str, ...]
    status: str


async def guarded_source(name: str, tool: Tool, window: Window) -> Evidence:
    try:
        value = await asyncio.wait_for(tool(window), 2.7)
        if value.source != name or value.window != window:
            return result(name, window, {"tool": name, "version": 1}, "INVALID")
        return value
    except (asyncio.TimeoutError, ConnectionError, OSError):
        return result(name, window, {"tool": name, "version": 1}, "UNAVAILABLE")
    except (ValueError, KeyError, TypeError):
        return result(name, window, {"tool": name, "version": 1}, "INVALID")


def extract_facts(evidence: list[Evidence]) -> list[Fact]:
    """Only finite observed scalars, with pointers into the exact saved payload."""
    by_source = {item.source: item for item in evidence}
    facts = []

    def add(identifier, source, pointer, value):
        if type(value) in {int, float} and math.isfinite(value):
            facts.append(
                Fact(id=identifier, source=source, pointer=pointer, value=value)
            )

    calculations = by_source["calculations"]
    for metric, name in (
        ("error_ratio", "error"),
        ("p95_seconds", "latency"),
        ("request_rate", "rate"),
    ):
        row = calculations.data.get("comparisons", {}).get(metric, {})
        if row.get("status") != "OK":
            continue
        for field, suffix in (
            ("before_mean", "before"),
            ("after_mean", "after"),
            ("absolute_delta", "delta"),
        ):
            add(
                f"metrics.{name}_{suffix}",
                "calculations",
                f"/data/comparisons/{metric}/{field}",
                row.get(field),
            )
    logs = by_source["loki"]
    if logs.status in {"OK", "PARTIAL"}:
        add(
            "logs.retrieved",
            "loki",
            "/data/retrieved_count",
            logs.data.get("retrieved_count"),
        )
        for code, value in sorted(logs.data.get("counts_by_status", {}).items()):
            if code in {"500", "502", "503", "504"}:
                add(
                    f"logs.http_{code}", "loki", f"/data/counts_by_status/{code}", value
                )
    releases = by_source["deployments"]
    if releases.status in {"OK", "PARTIAL"}:
        add(
            "deployments.verified",
            "deployments",
            "/data/verified_release_count",
            releases.data.get("verified_release_count"),
        )
    return facts


async def finish_analysis(
    evidence: list[Evidence],
    adapter: ModelAdapter | None = None,
    stages=("validate", "collect", "calculate"),
) -> InvestigationState:
    facts = extract_facts(evidence)
    model = await (adapter or DisabledAdapter()).analyze(facts)
    partial = any(item.status != "OK" for item in evidence) or model.status != "OK"
    return InvestigationState(
        evidence,
        facts,
        model,
        (*stages, "analyze", "validate-report"),
        "PARTIAL" if partial else "COMPLETED",
    )


async def run_sequential(
    window: Window, tools: dict[str, Tool], adapter: ModelAdapter | None = None
):
    # Validate even a caller-created model_copy before any tool can run.
    window = Window.model_validate(window.model_dump())
    if set(tools) != set(SOURCES):
        raise ValueError("Exactly three configured read-only tools are required")

    async def run():
        evidence = []
        for name in SOURCES:
            evidence.append(await guarded_source(name, tools[name], window))
        evidence.append(compare_metrics(evidence[0], evidence[1]))
        return await finish_analysis(evidence, adapter)

    return await asyncio.wait_for(run(), 17)
