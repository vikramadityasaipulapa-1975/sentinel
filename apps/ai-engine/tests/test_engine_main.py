"""Exercise the actual startup entry point without opening a listening socket."""

import asyncio
from pathlib import Path
import runpy
import sys

import pytest
import uvicorn


@pytest.mark.parametrize("platform, expected", [("win32", "asyncio:SelectorEventLoop"), ("linux", "auto")])
def test_entry_point_selects_uvicorn_loop_factory(monkeypatch, platform, expected):
    captured = {}
    monkeypatch.setenv("SENTINEL_EVIDENCE_SECRET", "a" * 64)
    monkeypatch.setenv("SENTINEL_PROMETHEUS_URL", "http://127.0.0.1:9090")
    monkeypatch.setenv("SENTINEL_LOKI_URL", "http://127.0.0.1:3100")
    monkeypatch.setenv("SENTINEL_DEPLOYMENT_READ_URL", "postgresql://reader:fake@127.0.0.1:1/demo")
    monkeypatch.setenv("SENTINEL_LLM_PROVIDER", "disabled")
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: captured.update(kwargs))
    # Limit the platform override to startup; restore it before other test code.
    with monkeypatch.context() as startup:
        startup.setattr(sys, "platform", platform)
        runpy.run_path(str(Path(__file__).resolve().parents[1] / "engine_main.py"), run_name="__main__")
    assert captured.get("loop", "auto") == expected
    assert captured["host"] == "127.0.0.1"
    if platform == "win32":
        factory = uvicorn.Config("engine:create_app", loop=captured["loop"]).get_loop_factory()
        loop = factory()
        try:
            assert isinstance(loop, asyncio.SelectorEventLoop)
        finally:
            loop.close()
