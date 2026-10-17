import asyncio
from dataclasses import replace

from hypothesis import ModelDraft
from llm_adapter import ModelResult
from synthesis import synthesize
from test_prometheus import window
from test_workflow import fixture_tools
from workflow import run_sequential


def state():
    win = window()
    return asyncio.run(run_sequential(win, fixture_tools(win)))


def test_citations_resolve_exact_saved_facts_and_do_not_claim_release_cause():
    report = synthesize(state())
    assert report["ai_performed"] is False
    assert all(row["category"] != "deployment" for row in report["hypotheses"])
    assert all(row["certainty"] == "hypothesis" for row in report["hypotheses"])
    facts = {row["id"]: row for row in report["facts"]}
    for row in report["hypotheses"]:
        assert set(row["supporting_fact_ids"]) <= facts.keys()
    assert "DEPLOYMENTS_EMPTY" in report["limitations"]


def test_model_cannot_force_unsupported_deployment_attribution():
    current = state()
    draft = ModelDraft.model_validate(
        {
            "conclusion": "HYPOTHESES_ONLY",
            "hypotheses": [
                {
                    "category": "deployment",
                    "supporting_fact_ids": ["logs.http_504"],
                    "contradicting_fact_ids": [],
                    "uncertainty": "low",
                }
            ],
        }
    )
    report = synthesize(
        replace(current, model=ModelResult("OK", draft, "fixture", True))
    )
    assert report["model_status"] == "INVALID" and report["ai_performed"] is False
    assert all(row["category"] != "deployment" for row in report["hypotheses"])


def test_no_facts_abstains_without_claiming_a_definitive_cause():
    report = synthesize(replace(state(), facts=[]))
    assert report["conclusion"] == "INSUFFICIENT_EVIDENCE"
    assert report["hypotheses"] == [] and report["status"] == "PARTIAL"
