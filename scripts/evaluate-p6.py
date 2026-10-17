"""Evaluate labelled fixtures; optional local model is explicitly opt-in."""

import argparse
import asyncio
import json
import sys

from local_support import ROOT

sys.path.insert(0, str(ROOT / "apps/ai-engine"))
from evaluation import evaluate  # noqa: E402
from llm_adapter import configured_adapter  # noqa: E402


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local-model", action="store_true")
    args = parser.parse_args()
    adapter = None
    if args.local_model:
        settings = dict(
            line.split("=", 1)
            for line in (ROOT / ".env.evidence")
            .read_text(encoding="utf-8")
            .splitlines()
            if line and not line.startswith("#")
        )
        if settings.get("SENTINEL_LLM_PROVIDER") != "ollama":
            raise SystemExit(
                "Configure a local Ollama model first; no network calls made"
            )
        adapter = configured_adapter(settings)
    report = await evaluate(adapter)
    path = ROOT / (
        ".artifacts/p6-local-model-evaluation.json"
        if args.local_model
        else ".artifacts/p6-baseline-evaluation.json"
    )
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {key: value for key, value in report.items() if key != "results"}, indent=2
        )
    )
    print("Report:", path)


if __name__ == "__main__":
    asyncio.run(main())
