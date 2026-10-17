import asyncio
import json

import httpx

from .http import bounded_json, endpoint
from .models import Window, result


async def search_loki(client: httpx.AsyncClient, base: str, window: Window):
    url = endpoint(base) + "/loki/api/v1/query_range"
    # Fixed service selector; no caller-provided LogQL or pipeline expressions.
    params = {
        "query": f'{{service="{window.service}"}}',
        "start": str(int(window.start.timestamp() * 1_000_000_000)),
        "end": str(int(window.end.timestamp() * 1_000_000_000)),
        "limit": 100,
        "direction": "backward",
    }
    locator = {"url": url, **params}
    try:
        body = await asyncio.wait_for(bounded_json(client, url, params), 2.5)
        if body.get("status") != "success" or body["data"]["resultType"] != "streams":
            raise ValueError("Unexpected Loki response")
        rows = []
        for stream in body["data"]["result"]:
            if stream["stream"].get("service") != window.service:
                raise ValueError("Mismatched service")
            for stamp, line in stream["values"]:
                if not int(params["start"]) <= int(stamp) <= int(params["end"]):
                    raise ValueError("Out-of-window log")
                if len(rows) >= 100:
                    raise ValueError("Source exceeded limit")
                parsed = json.loads(line)
                if not isinstance(parsed, dict):
                    raise ValueError("Expected JSON log object")
                # Never return free-form message/body/header fields, even if the
                # monitored application starts logging them in the future.
                safe = {
                    key: str(parsed[key])[:200]
                    for key in (
                        "event",
                        "method",
                        "route",
                        "status_code",
                        "duration_ms",
                        "request_id",
                        "trace_id",
                        "error_code",
                        "status",
                    )
                    if key in parsed
                }
                safe["status_code"] = safe.pop(
                    "status", safe.get("status_code", "unknown")
                )
                rows.append({"timestamp_ns": str(stamp), **safe})
        rows.sort(key=lambda row: int(row["timestamp_ns"]), reverse=True)
        counts = {}
        for row in rows:
            code = row.get("status_code", "unknown")
            counts[code] = counts.get(code, 0) + 1
        truncated = len(rows) == 100
        return result(
            "loki",
            window,
            locator,
            "PARTIAL" if truncated else "OK" if rows else "EMPTY",
            retrieved_count=len(rows),
            counts_by_status=counts,
            count_scope="retrieved_records_only",
            truncated=truncated,
            samples=rows[:5],
        )
    except (httpx.HTTPError, asyncio.TimeoutError):
        return result("loki", window, locator, "UNAVAILABLE")
    except (ValueError, KeyError, TypeError, IndexError):
        return result("loki", window, locator, "INVALID")
