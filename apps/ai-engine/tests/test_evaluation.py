import asyncio

from evaluation import evaluate


def test_labelled_baseline_citations_and_known_false_attribution_are_reported():
    report = asyncio.run(evaluate())
    assert report["scenario_count"] == 10
    assert report["citation_validity"] == 1
    assert report["no_cause_abstention"] == 1
    rows = report["results"]
    nondeployment = [
        row for row in rows if row["ground_truth"] not in {None, "deployment"}
    ]
    expected = sum(row["ranked"][:1] == ["deployment"] for row in nondeployment) / len(
        nondeployment
    )
    assert report["false_deployment_attribution"] == expected
    assert report["cohorts"]["deployment"]["count"] == 1
    assert report["cohorts"]["nondeployment"]["count"] == 6
    assert report["top_2_accuracy"] >= report["top_1_accuracy"]
    assert (
        report["live_telemetry"] is False
        and report["live_model_calls_requested"] is False
    )
