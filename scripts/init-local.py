"""Create ignored local demo credentials once; never print their values."""

import secrets
from pathlib import Path

path = Path(__file__).resolve().parent.parent / ".env"
if path.exists():
    print("Existing .env preserved; no changes made")
else:
    password = secrets.token_hex(24)
    # Exclusive creation avoids overwriting a concurrently created configuration.
    with path.open("x", encoding="utf-8") as handle:
        handle.write(
            f"POSTGRES_PASSWORD={password}\n"
            f"DATABASE_URL=postgresql://sentinel:{password}@127.0.0.1:55432/sentinel\n"
            "STORAGE_MODE=postgres\nPAYMENT_VERSION=payment-v1\n"
            "PAYMENT_URL=http://127.0.0.1:3002\nPAYMENT_TIMEOUT_MS=1000\nPAYMENT_MAX_ATTEMPTS=2\n"
        )
    print("Created ignored .env with random local demo credentials; values omitted")
