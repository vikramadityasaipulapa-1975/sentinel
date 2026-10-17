import asyncio
import sys

import uvicorn
from engine import create_app

if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    uvicorn.run(
        create_app(),
        host="127.0.0.1",
        port=8001,
        access_log=False,
        log_level="warning",
        limit_concurrency=8,
        timeout_keep_alive=2,
    )
