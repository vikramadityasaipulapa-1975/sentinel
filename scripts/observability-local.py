"""Start the approved loopback observability demo; Ctrl+C stops only owned apps."""

import time

from observability_support import DATA, Demo, compose, run


if __name__ == "__main__":
    try:
        with Demo() as demo:
            run(compose("up", "-d"))
            print(
                "Local observability demo ready. Simulated memory-only payments; no production data.",
                flush=True,
            )
            while all(child.poll() is None for child in demo.children.values()):
                if any(
                    path.stat().st_size > 20_000_000
                    for path in (DATA / "logs").glob("*.log")
                ):
                    raise RuntimeError(
                        "Demo log budget reached; archive logs before restarting"
                    )
                time.sleep(1)
    except KeyboardInterrupt:
        print("Owned demo apps stopped; collector containers and volumes retained")
