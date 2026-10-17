"""Cited, nondefinitive reports; measurements and prose are backend-owned."""

from workflow import InvestigationState

TITLES = {
    "deployment": "Possible deployment-related regression",
    "dependency": "Possible dependency failure or latency",
    "load": "Possible load-related degradation",
    "application": "Possible application error",
}


def synthesize(state: InvestigationState) -> dict:
    facts = {fact.id: fact for fact in state.facts}
    values = {key: fact.value for key, fact in facts.items()}
    candidates = []

    def add(category, support, contradict=()):
        candidates.append(
            {
                "rank": len(candidates) + 1,
                "category": category,
                "title": TITLES[category],
                "supporting_fact_ids": list(support),
                "contradicting_fact_ids": [key for key in contradict if key in facts],
                "uncertainty": "high",
                "certainty": "hypothesis",
            }
        )

    errors = values.get("metrics.error_after", 0) >= 0.05
    if (
        values.get("deployments.verified", 0) > 0
        and values.get("metrics.error_delta", 0) > 0.05
    ):
        add("deployment", ["deployments.verified", "metrics.error_delta"])
    dependency = [
        key for key in ("logs.http_502", "logs.http_504") if values.get(key, 0) > 0
    ]
    if dependency:
        add("dependency", dependency)
    if (
        values.get("metrics.rate_before", 0) > 0
        and values.get("metrics.rate_after", 0) >= 2 * values["metrics.rate_before"]
        and values.get("metrics.latency_delta", 0) > 0.1
    ):
        add(
            "load",
            ["metrics.rate_before", "metrics.rate_after", "metrics.latency_delta"],
        )
    if errors or values.get("logs.http_500", 0) > 0:
        support = ["metrics.error_after"] if errors else ["logs.http_500"]
        contradiction = (
            ["metrics.error_delta"] if values.get("metrics.error_delta", 0) < 0 else []
        )
        add("application", support, contradiction)
    candidates = candidates[:3]
    model_status = state.model.status
    ai_performed = False
    if model_status == "OK" and state.model.draft is not None:
        by_category = {item["category"]: item for item in candidates}
        draft = state.model.draft
        if draft.conclusion == "INSUFFICIENT_EVIDENCE":
            candidates = []
            ai_performed = True
        elif all(
            item.category in by_category
            and set(item.supporting_fact_ids)
            <= set(by_category[item.category]["supporting_fact_ids"])
            and set(item.contradicting_fact_ids)
            <= set(by_category[item.category]["contradicting_fact_ids"])
            for item in draft.hypotheses
        ):
            # Preserve backend-selected facts/contradictions; model changes order only.
            chosen = [by_category[item.category] for item in draft.hypotheses]
            candidates = chosen + [item for item in candidates if item not in chosen]
            ai_performed = True
        else:
            model_status = "INVALID"
    for rank, item in enumerate(candidates, 1):
        item["rank"] = rank
    limitations = [
        "CORRELATION_NOT_CAUSATION",
        "RULES_NOT_CALIBRATED",
        "LOG_COUNTS_RETRIEVED_ONLY",
    ]
    limitations += [
        f"{row.source.upper()}_{row.status}"
        for row in state.evidence
        if row.status != "OK"
    ]
    if model_status != "OK":
        limitations.append("MODEL_" + model_status)
    partial = any(row.status != "OK" for row in state.evidence) or model_status not in {
        "OK",
        "DISABLED",
    }
    if not candidates:
        limitations.append("INSUFFICIENT_CAUSAL_EVIDENCE")
    return {
        "version": 1,
        "mode": "model-assisted" if ai_performed else "deterministic",
        "model_status": model_status,
        "model_name": state.model.model,
        "ai_performed": ai_performed,
        "status": "PARTIAL" if partial or not candidates else "COMPLETED",
        "conclusion": "HYPOTHESES_ONLY" if candidates else "INSUFFICIENT_EVIDENCE",
        "hypotheses": candidates,
        "facts": [fact.model_dump(mode="json") for fact in state.facts],
        "limitations": limitations,
    }
