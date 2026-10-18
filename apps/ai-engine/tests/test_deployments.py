import pytest
from evidence.deployments import validate_dsn


@pytest.mark.parametrize(
    "value",
    [
        "https://host",
        "postgresql://reader@host/db",
        "postgresql://r:p@host/db?sslmode=disable",
    ],
)
def test_rejects_unsafe_dsn(value):
    with pytest.raises(ValueError):
        validate_dsn(value)


def test_accepts_explicit_reader():
    assert validate_dsn("postgresql://reader:fake@localhost/demo").username == "reader"


def test_deployment_reader_returns_empty_for_successful_query(monkeypatch):
    import asyncio
    from evidence import deployments
    from test_prometheus import window

    captured = {}

    class Connection:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def execute(self, query, args):
            captured["query"] = query
            captured["args"] = args
            return self

        async def fetchall(self):
            return []

    async def connect(dsn, **kwargs):
        captured.update(kwargs)
        return Connection()

    monkeypatch.setattr(deployments.psycopg.AsyncConnection, "connect", connect)
    result = asyncio.run(deployments.query_deployments("postgresql://reader:fake@127.0.0.1:1/demo", window()))
    assert result.status == "EMPTY"
    assert result.data["releases"] == []
    assert "default_transaction_read_only=on" in captured["options"]
    assert "statement_timeout=1500" in captured["options"]
    assert captured["args"][0] == window().service
    assert "WHERE d.service=%s" in captured["query"]


def test_deployment_reader_failure_is_unavailable_not_empty(monkeypatch):
    import asyncio
    from evidence import deployments
    from test_prometheus import window

    async def connect(*args, **kwargs):
        raise deployments.psycopg.OperationalError("synthetic credential detail must not escape")

    monkeypatch.setattr(deployments.psycopg.AsyncConnection, "connect", connect)
    result = asyncio.run(deployments.query_deployments("postgresql://reader:fake@127.0.0.1:1/demo", window()))
    assert result.status == "UNAVAILABLE"
    assert result.data == {}
    assert "synthetic credential" not in result.model_dump_json()
