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
