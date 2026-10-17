import asyncio

from investigation_graph import run_parallel
from test_prometheus import window
from test_workflow import fixture_tools
from workflow import run_sequential


def test_parallel_branches_overlap_and_join_once_with_source_failure():
    async def check():
        win = window()
        fixtures = fixture_tools(win)
        entered = set()
        all_entered = asyncio.Event()

        def tool(name):
            async def invoke(value):
                entered.add(name)
                if len(entered) == 3:
                    all_entered.set()
                await asyncio.wait_for(all_entered.wait(), 0.5)
                if name == "loki":
                    raise ConnectionError("fixture")
                return await fixtures[name](value)

            return invoke

        state = await run_parallel(win, {name: tool(name) for name in fixtures})
        assert state.status == "PARTIAL" and entered == set(fixtures)
        assert len(state.evidence) == 4 and state.evidence[1].status == "UNAVAILABLE"
        assert state.stages.count("calculate") == 1

    asyncio.run(check())


def test_parallel_and_reference_workflow_produce_identical_facts():
    async def check():
        win = window()
        sequential = await run_sequential(win, fixture_tools(win))
        parallel = await run_parallel(win, fixture_tools(win))
        assert sequential.facts == parallel.facts
        assert sequential.status == parallel.status

    asyncio.run(check())
