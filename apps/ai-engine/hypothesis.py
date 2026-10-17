"""Model output contains selections and citations, never invented measurements."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Category = Literal["deployment", "dependency", "load", "application"]


class Fact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)
    id: str = Field(pattern=r"^[a-z][a-z0-9_.]{0,79}$")
    source: Literal["prometheus", "loki", "deployments", "calculations"]
    pointer: str = Field(pattern=r"^/data/", max_length=200)
    value: float | int | bool | str = Field(union_mode="left_to_right")


class Hypothesis(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    category: Category
    supporting_fact_ids: list[str] = Field(min_length=1, max_length=6)
    contradicting_fact_ids: list[str] = Field(max_length=6)
    uncertainty: Literal["low", "medium", "high"]

    @model_validator(mode="after")
    def distinct(self):
        support, against = self.supporting_fact_ids, self.contradicting_fact_ids
        if len(set(support)) != len(support) or len(set(against)) != len(against):
            raise ValueError("Duplicate fact citation")
        if set(support) & set(against):
            raise ValueError("A fact cannot both support and contradict one hypothesis")
        return self


class ModelDraft(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    conclusion: Literal["HYPOTHESES_ONLY", "INSUFFICIENT_EVIDENCE"]
    hypotheses: list[Hypothesis] = Field(max_length=3)

    @model_validator(mode="after")
    def coherent(self):
        if (self.conclusion == "HYPOTHESES_ONLY") != bool(self.hypotheses):
            raise ValueError("Conclusion must match the hypothesis list")
        if len({h.category for h in self.hypotheses}) != len(self.hypotheses):
            raise ValueError("Duplicate category")
        return self


def validate_draft(raw: str, facts: list[Fact]) -> ModelDraft:
    if len(raw.encode("utf-8")) > 16384:
        raise ValueError("Model output exceeds 16 KiB")
    draft = ModelDraft.model_validate_json(raw)
    allowed = {fact.id for fact in facts}
    for item in draft.hypotheses:
        if not set(item.supporting_fact_ids + item.contradicting_fact_ids) <= allowed:
            raise ValueError("Unknown evidence citation")
    return draft
