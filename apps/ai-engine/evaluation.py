"""Labelled synthetic evidence evaluation; not live model accuracy by default."""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from evidence.models import Window, result
from investigation_graph import run_parallel
from synthesis import synthesize


def load_scenarios():
    return json.loads(
        (Path(__file__).parent / "evaluation/scenarios.json").read_text(
            encoding="utf-8"
        )
    )


def scenario_tools(case, window):
    locator = {"kind": "synthetic-labelled-scenario", "scenario": case["id"]}
    if case.get("missing"):
        records = {
            source: result(source, window, locator, "UNAVAILABLE")
            for source in ("prometheus", "loki", "deployments")
        }
    else:
        start = window.start.timestamp()
        series = {}
        for metric, name in (
            ("error_ratio", "error"),
            ("request_rate", "rate"),
            ("p95_seconds", "latency"),
        ):
            series[metric] = [
                [start + i * 15, case[("before_" if i < 20 else "after_") + name]]
                for i in range(40)
            ]
        releases = case["verified_releases"]
        records = {
            "prometheus": result("prometheus", window, locator, series=series),
            "loki": result(
                "loki",
                window,
                locator,
                retrieved_count=sum(case["logs"].values()),
                counts_by_status=case["logs"],
                samples=[],
                truncated=False,
            ),
            "deployments": result(
                "deployments",
                window,
                locator,
                "EMPTY" if releases is None else "OK",
                verified_release_count=releases or 0,
                releases=[
                    {
                        "version": "fixture-v1",
                        "verified_at": (window.end - timedelta(seconds=1)).isoformat(),
                        "fixture": True,
                    }
                ]
                if releases
                else [],
            ),
        }

    def tool(name):
        async def invoke(_):
            return records[name]

        return invoke

    return {name: tool(name) for name in records}


def citation_validity(report, evidence):
    by_source = {row.source: row for row in evidence}
    valid = total = 0
    facts = {fact["id"]: fact for fact in report["facts"]}
    for candidate in report["hypotheses"]:
        for identifier in (
            candidate["supporting_fact_ids"] + candidate["contradicting_fact_ids"]
        ):
            total += 1
            try:
                fact = facts[identifier]
                current = by_source[fact["source"]].model_dump(mode="json")
                for key in fact["pointer"].strip("/").split("/"):
                    current = (
                        current[int(key)] if isinstance(current, list) else current[key]
                    )
                valid += current == fact["value"]
            except (KeyError, TypeError, ValueError, IndexError):
                pass
    return valid, total


async def evaluate(adapter=None):
    end = datetime.now(timezone.utc)
    window = Window(
        service="payment-service", start=end - timedelta(minutes=10), end=end
    )
    rows = []
    valid = total = correct_candidates = candidates = 0
    for case in load_scenarios():
        state = await run_parallel(window, scenario_tools(case, window), adapter)
        report = synthesize(state)
        ranked = [row["category"] for row in report["hypotheses"]]
        correct_candidates += case["cause"] in ranked if case["cause"] else 0
        candidates += len(ranked)
        good, count = citation_validity(report, state.evidence)
        valid += good
        total += count
        rows.append(
            {
                "id": case["id"],
                "ground_truth": case["cause"],
                "ranked": ranked,
                "conclusion": report["conclusion"],
                "model_status": report["model_status"],
                "ai_performed": report["ai_performed"],
                "citation_valid": good == count,
            }
        )
    labelled = [row for row in rows if row["ground_truth"] is not None]
    nondeployment = [row for row in labelled if row["ground_truth"] != "deployment"]
    no_cause = [row for row in rows if row["ground_truth"] is None]

    def accuracy(k):
        return sum(row["ground_truth"] in row["ranked"][:k] for row in labelled) / len(
            labelled
        )

    return {
        "dataset": "synthetic-normalized-evidence-v1",
        "at": end.isoformat(),
        "mode": "local-model-on-fixtures" if adapter else "deterministic-baseline",
        "live_telemetry": False,
        "live_model_calls_requested": adapter is not None,
        "validated_model_report_count": sum(row["ai_performed"] for row in rows),
        "model_status_counts": {
            status: sum(row["model_status"] == status for row in rows)
            for status in sorted({row["model_status"] for row in rows})
        },
        "scenario_count": len(rows),
        "cohorts": {
            name: {
                "count": len(group),
                "top_1_hits": sum(
                    row["ranked"][:1] == [row["ground_truth"]] for row in group
                ),
            }
            for name, group in (
                (
                    "deployment",
                    [r for r in labelled if r["ground_truth"] == "deployment"],
                ),
                ("nondeployment", nondeployment),
            )
        },
        "candidate_correct_count": correct_candidates,
        "candidate_total_count": candidates,
        "citation_reference_count": total,
        "labelled_cause_count": len(labelled),
        "top_1_accuracy": accuracy(1),
        "top_2_accuracy": accuracy(2),
        "candidate_precision": correct_candidates / candidates if candidates else None,
        "false_deployment_attribution": sum(
            row["ranked"][:1] == ["deployment"] for row in nondeployment
        )
        / len(nondeployment),
        "no_cause_abstention": sum(not row["ranked"] for row in no_cause)
        / len(no_cause),
        "citation_validity": valid / total if total else None,
        "limitation": "Small hand-authored fixtures; not real-world or live model accuracy. Causal attribution can remain wrong despite valid citations.",
        "results": rows,
    }
