import json
from urllib.parse import urlsplit

import httpx


def endpoint(value: str) -> str:
    url = urlsplit(value)
    if (
        url.scheme not in {"http", "https"}
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path not in {"", "/"}
    ):
        raise ValueError("Invalid source endpoint")
    if url.scheme == "http" and url.hostname not in {"localhost", "127.0.0.1"}:
        raise ValueError("Remote sources require verified HTTPS")
    return value.rstrip("/")


async def bounded_json(client: httpx.AsyncClient, url: str, params: dict):
    # Streaming enforces the cap before JSON parsing; redirects are never followed.
    async with client.stream(
        "GET", url, params=params, timeout=2, follow_redirects=False
    ) as response:
        response.raise_for_status()
        raw = bytearray()
        async for chunk in response.aiter_bytes():
            raw.extend(chunk)
            if len(raw) > 262144:
                raise ValueError("Source response exceeds 256 KiB")
        body = json.loads(raw)
        if not isinstance(body, dict):
            raise ValueError("Expected source JSON object")
        return body
