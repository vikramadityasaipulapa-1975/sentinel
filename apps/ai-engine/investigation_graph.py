"""Parallel read branches with a single barrier and bounded analysis stage."""

import asyncio
from typing import TypedDict

from evidence.calculations import compare_metrics
from evidence.models import Evidence, Window
from langgraph.graph import END, START, StateGraph
from llm_adapter import ModelAdapter
from workflow import SOURCES, InvestigationState, Tool, finish_analysis, guarded_source


class GraphState(TypedDict, total=False):
    window: Window
    prometheus: Evidence
    loki: Evidence
    deployments: Evidence
    evidence: list[Evidence]
    result: InvestigationState


def build_graph(tools: dict[str, Tool], adapter: ModelAdapter | None = None):
    if set(tools) != set(SOURCES):
        raise ValueError("Exactly three read-only tools are required")
    graph = StateGraph(GraphState)

    def branch(name):
        async def invoke(state):
            return {name: await guarded_source(name, tools[name], state["window"])}

        return invoke

    for name in SOURCES:
        graph.add_node(name, branch(name))
        graph.add_edge(START, name)

    def calculate(state):
        evidence = [state[name] for name in SOURCES]
        return {"evidence": [*evidence, compare_metrics(evidence[0], evidence[1])]}

    async def analyze(state):
        return {
            "result": await finish_analysis(
                state["evidence"],
                adapter,
                ("validate", "parallel-collect", "calculate"),
            )
        }

    graph.add_node("calculate", calculate)
    graph.add_node("analyze", analyze)
    graph.add_edge(list(SOURCES), "calculate")
    graph.add_edge("calculate", "analyze")
    graph.add_edge("analyze", END)
    # Durable retries/fencing are owned by PostgreSQL/BullMQ, not an in-memory
    # graph checkpoint falsely presented as crash-safe persistence.
    return graph.compile()


async def run_parallel(
    window: Window, tools: dict[str, Tool], adapter: ModelAdapter | None = None
):
    window = Window.model_validate(window.model_dump())
    state = await asyncio.wait_for(
        build_graph(tools, adapter).ainvoke(
            {"window": window}, config={"recursion_limit": 6, "callbacks": []}
        ),
        12,
    )
    return state["result"]
