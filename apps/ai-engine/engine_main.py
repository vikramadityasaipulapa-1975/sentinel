import sys

import uvicorn
from engine import create_app

if __name__ == "__main__":
    uvicorn.run(
        create_app(),
        # Uvicorn uses its own factory; a global loop policy is insufficient.
        # Psycopg async connections require SelectorEventLoop on Windows.
        loop="asyncio:SelectorEventLoop" if sys.platform == "win32" else "auto",
        host="127.0.0.1",
        port=8001,
        access_log=False,
        log_level="warning",
        limit_concurrency=8,
        timeout_keep_alive=2,
    )
