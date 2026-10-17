import asyncio
import math

import httpx

from .http import bounded_json, endpoint
from .models import Window, result


def queries(service):
    labels = f'service="{service}"'
    return {
        "request_rate": f"sum(rate(sentinel_http_requests_total{{{labels}}}[1m]))",
        "error_ratio": (
            f'sum(rate(sentinel_http_requests_total{{{labels},status_code=~"5.."}}[1m]))'
            f" / sum(rate(sentinel_http_requests_total{{{labels}}}[1m]))"
        ),
        "p95_seconds": (
            f"histogram_quantile(0.95, sum by (le) "
            f"(rate(sentinel_http_request_duration_seconds_bucket{{{labels}}}[1m])))"
        ),
    }


async def query_prometheus(client: httpx.AsyncClient, base: str, window: Window):
    url = endpoint(base) + "/api/v1/query_range"
    params = {
        "start": math.ceil(window.start.timestamp()),
        "end": math.floor(window.end.timestamp()),
        "step": 15,
    }
    locator = {"url": url, "queries": queries(window.service), **params}

    async def one(name, query):
        body = await bounded_json(client, url, {**params, "query": query})
        if body.get("status") != "success" or body["data"]["resultType"] != "matrix":
            raise ValueError("Unexpected Prometheus response")
        series = body["data"]["result"]
        if len(series) > 1:
            raise ValueError("Aggregated query returned multiple series")
        values = series[0]["values"] if series else []
        if len(values) > 121:
            raise ValueError("Too many points")
        points = []
        rejected = 0
        for stamp, raw in values:
            stamp, value = float(stamp), float(raw)
            if (
                not math.isfinite(stamp)
                or not window.start.timestamp() <= stamp <= window.end.timestamp()
            ):
                raise ValueError("Out-of-window point")
            if not math.isfinite(value):
                rejected += 1
                continue
            if points and stamp <= points[-1][0]:
                raise ValueError("Unordered points")
            points.append([stamp, value])
        return name, points, rejected

    try:
        rows = await asyncio.wait_for(
            asyncio.gather(*(one(k, v) for k, v in queries(window.service).items())),
            2.5,
        )
        series = {name: points for name, points, _ in rows}
        rejected = sum(count for _, _, count in rows)
        status = "PARTIAL" if rejected else "OK" if any(series.values()) else "EMPTY"
        if status == "OK" and all(
            not points or window.end.timestamp() - points[-1][0] > 60
            for points in series.values()
        ):
            status = "STALE"
        return result(
            "prometheus",
            window,
            locator,
            status,
            series=series,
            rejected_nonfinite=rejected,
            step_seconds=15,
        )
    except (httpx.HTTPError, asyncio.TimeoutError):
        return result("prometheus", window, locator, "UNAVAILABLE")
    except (ValueError, KeyError, TypeError, IndexError):
        return result("prometheus", window, locator, "INVALID")
