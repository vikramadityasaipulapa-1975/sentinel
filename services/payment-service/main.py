"""Local demo payment API. No real money or persistent records."""

from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="Sentinel demo payment service", version="0.1.0")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "payment-service"}

    return app


app = create_app()
