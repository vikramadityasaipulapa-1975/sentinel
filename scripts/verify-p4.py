"""Real local collector verification. Artifacts contain measurements, never credentials."""

import argparse
import json
from datetime import UTC, datetime

from observability_support import DATA, Demo, checkout, compose, http, query, run, wait


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", choices=["P4.2", "P4.3"], default="P4.2")
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    report = {
        "task": args.task,
        "run_at": datetime.now(UTC).isoformat(),
        "status": "RUNNING",
    }
    try:
        with Demo() as demo:
            run(
                compose(
                    "up",
                    "-d",
                    "prometheus",
                    *(["loki", "alloy"] if args.task != "P4.2" else []),
                )
            )
            wait(
                lambda: (
                    len(query('up{job="sentinel-demo"}')) == 2
                    and all(
                        float(row["value"][1]) == 1
                        for row in query('up{job="sentinel-demo"}')
                    )
                )
            )
            for _ in range(4):
                assert checkout()[0] == 201
            wait(
                lambda: bool(
                    query(
                        'sum(sentinel_http_requests_total{route="/checkout",status_code="201"}) >= 4'
                    )
                )
            )
            report["healthy_targets"] = 2
            demo.payment("error")
            assert checkout()[0] == 502
            wait(
                lambda: bool(
                    query(
                        'sum(sentinel_http_requests_total{route="/checkout",status_code="502"}) == 1'
                    )
                )
            )
            for _ in range(4):
                assert checkout()[0] == 502
            wait(
                lambda: bool(
                    query(
                        'sum(rate(sentinel_http_requests_total{route="/checkout",status_code=~"5.."}[1m])) > 0'
                    )
                )
            )
            report["fault_error_rate_detected"] = True
            assert http(9090, "/api/v1/query?query=%28")[0] in (400, 422)
            report["invalid_query_rejected"] = True
            count = query(
                'sum(sentinel_http_requests_total{route="/checkout",status_code="502"})'
            )[0]
            timestamp = count["value"][0]
            run(compose("restart", "prometheus"))
            wait(lambda: http(9090, "/-/ready")[0] == 200)
            from urllib.parse import urlencode

            status, old = http(
                9090,
                "/api/v1/query?"
                + urlencode(
                    {
                        "query": 'sum(sentinel_http_requests_total{route="/checkout",status_code="502"})',
                        "time": timestamp,
                    }
                ),
            )
            assert (
                status == 200
                and old["data"]["result"][0]["value"][1] == count["value"][1]
            )
            report["retained_samples_after_restart"] = True
            if args.task == "P4.3":
                from urllib.parse import urlencode
                from uuid import uuid4

                marker = str(uuid4())
                demo.payment("latency")
                assert (
                    http(
                        3001,
                        "/checkout",
                        {
                            "order_id": str(uuid4()),
                            "amount_minor": 100,
                            "currency": "INR",
                        },
                        {"x-request-id": marker},
                    )[0]
                    == 504
                )
                expression = (
                    '{service="checkout-service"} | json | request_id="'
                    + marker
                    + '" | status=504'
                )

                def logs():
                    code, result = http(
                        3100,
                        "/loki/api/v1/query_range?"
                        + urlencode({"query": expression, "limit": 10}),
                    )
                    return code == 200 and bool(result["data"]["result"])

                wait(logs, 90)
                code, labels = http(3100, "/loki/api/v1/labels")
                assert code == 200 and "request_id" not in labels["data"]
                assert http(3100, "/loki/api/v1/query_range?query=%7B")[0] in (400, 422)
                report["real_timeout_log_in_loki"] = True
                report["request_ids_not_index_labels"] = True
        report["status"] = "PASSED"
    except Exception as error:
        report.update(status="FAILED", error_type=type(error).__name__)
        raise
    finally:
        (DATA / f"{args.task.lower()}-verification.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
    print(f"PASS: {args.task} real collector verification", flush=True)


if __name__ == "__main__":
    main()
