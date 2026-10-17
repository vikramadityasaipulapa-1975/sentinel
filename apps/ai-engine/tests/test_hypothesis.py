import asyncio
import json

import httpx
import pytest
from hypothesis import Fact, validate_draft
from llm_adapter import OllamaAdapter, configured_adapter


def facts():
    return [
        Fact(
            id="metrics.error_after",
            source="calculations",
            pointer="/data/comparisons/error_ratio/after_mean",
            value=0.5,
        )
    ]


def draft():
    return {
        "conclusion": "HYPOTHESES_ONLY",
        "hypotheses": [
            {
                "category": "application",
                "supporting_fact_ids": ["metrics.error_after"],
                "contradicting_fact_ids": [],
                "uncertainty": "high",
            }
        ],
    }


def test_valid_cited_draft_and_explicit_insufficiency():
    assert (
        validate_draft(json.dumps(draft()), facts()).hypotheses[0].category
        == "application"
    )
    assert (
        validate_draft(
            '{"conclusion":"INSUFFICIENT_EVIDENCE","hypotheses":[]}', []
        ).hypotheses
        == []
    )


@pytest.mark.parametrize(
    "raw",
    [
        "not JSON",
        "{}",
        "x" * 16385,
        json.dumps({**draft(), "execute": "delete something"}),
        json.dumps(draft()).replace("metrics.error_after", "invented.measurement"),
        json.dumps(draft()).replace('"high"', "0.99"),
    ],
)
def test_malformed_unknown_and_action_outputs_are_rejected(raw):
    with pytest.raises(ValueError):
        validate_draft(raw, facts())


def test_adapter_contract_and_safe_network_errors():
    async def check():
        async def transport(request):
            sent = json.loads(request.content)
            assert (
                sent["stream"] is False
                and sent["format"]["additionalProperties"] is False
            )
            return httpx.Response(
                200, json={"done": True, "message": {"content": json.dumps(draft())}}
            )

        adapter = OllamaAdapter(
            "http://localhost:11434", "test-model", httpx.MockTransport(transport)
        )
        assert (await adapter.analyze(facts())).ai_performed is True
        adapter.transport = httpx.MockTransport(
            lambda _: httpx.Response(200, json={"message": {}})
        )
        assert (await adapter.analyze(facts())).status == "INVALID"
        adapter.transport = httpx.MockTransport(lambda _: httpx.Response(503))
        assert (await adapter.analyze(facts())).status == "UNAVAILABLE"

        def timeout(_):
            raise httpx.ReadTimeout("fixture")

        adapter.transport = httpx.MockTransport(timeout)
        assert (await adapter.analyze(facts())).status == "TIMEOUT"
        assert (await configured_adapter({}).analyze(facts())).status == "DISABLED"

    asyncio.run(check())


def test_remote_or_unexpected_model_configuration_is_rejected():
    with pytest.raises(ValueError):
        OllamaAdapter("https://remote.example", "model")
    with pytest.raises(ValueError):
        configured_adapter({"SENTINEL_LLM_PROVIDER": "unknown"})


def test_local_model_requires_explicit_local_only_confirmation():
    settings = {
        "SENTINEL_LLM_PROVIDER": "ollama",
        "SENTINEL_LLM_URL": "http://127.0.0.1:11434",
        "SENTINEL_LLM_MODEL": "local-test",
    }
    with pytest.raises(ValueError):
        configured_adapter(settings)
    assert isinstance(
        configured_adapter({**settings, "SENTINEL_LLM_LOCAL_ONLY": "1"}), OllamaAdapter
    )
    with pytest.raises(ValueError):
        OllamaAdapter("http://127.0.0.1:11434", "example:cloud")
