"""Payment owns the demo order/payment transaction; callers use HTTP only."""

from threading import Lock
from uuid import UUID, uuid4

import psycopg
from config import Settings
from models import PaymentRequest, PaymentResponse
from psycopg.rows import dict_row


class PaymentConflict(Exception):
    def __init__(self, code="IDEMPOTENCY_CONFLICT"):
        self.code = code
        super().__init__(code)


def same_request(result: PaymentResponse, request: PaymentRequest) -> bool:
    return all(
        getattr(result, key) == getattr(request, key)
        for key in ("order_id", "amount_minor", "currency")
    )


class MemoryStore:
    """Explicit non-durable P1 mode/test adapter, never a database fallback."""

    def __init__(self):
        self.lock = Lock()
        self.by_key = {}
        self.by_order = {}

    def ready(self):
        return True

    def save(self, request: PaymentRequest, key: UUID) -> PaymentResponse:
        with self.lock:
            if key in self.by_key:
                result = self.by_key[key]
                if not same_request(result, request):
                    raise PaymentConflict()
                return result
            if request.order_id in self.by_order:
                raise PaymentConflict("ORDER_ALREADY_PAID")
            result = PaymentResponse(
                **request.model_dump(), payment_id=uuid4(), status="succeeded"
            )
            self.by_key[key] = result
            self.by_order[request.order_id] = result
            return result


class PostgresStore:
    def __init__(self, dsn: str):
        Settings(storage_mode="postgres", database_url=dsn)
        self.dsn = dsn

    def connect(self):
        return psycopg.connect(
            self.dsn,
            connect_timeout=3,
            row_factory=dict_row,
            options="-c timezone=UTC -c statement_timeout=3000 -c lock_timeout=2000",
        )

    def ready(self):
        with self.connect() as conn:
            return conn.execute(
                "SELECT to_regclass('demo_orders') IS NOT NULL AND to_regclass('demo_payments') IS NOT NULL AS ready"
            ).fetchone()["ready"]

    def save(self, request: PaymentRequest, key: UUID) -> PaymentResponse:
        with self.connect() as conn:
            # Serialize requests sharing a key OR order, with a consistent lock order.
            for resource in sorted((f"key:{key}", f"order:{request.order_id}")):
                conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (resource,)
                )
            row = conn.execute(
                "SELECT o.id AS order_id, o.amount_minor, o.currency, p.id AS payment_id, p.status "
                "FROM demo_payments p JOIN demo_orders o ON o.id=p.order_id WHERE p.idempotency_key=%s",
                (key,),
            ).fetchone()
            if row:
                result = PaymentResponse(**row)
                if not same_request(result, request):
                    raise PaymentConflict()
                return result
            if conn.execute(
                "SELECT 1 FROM demo_payments WHERE order_id=%s", (request.order_id,)
            ).fetchone():
                raise PaymentConflict("ORDER_ALREADY_PAID")
            payment_id = uuid4()
            conn.execute(
                "INSERT INTO demo_orders (id, amount_minor, currency) VALUES (%s, %s, %s)",
                (request.order_id, request.amount_minor, request.currency),
            )
            conn.execute(
                "INSERT INTO demo_payments (id, order_id, idempotency_key, status) VALUES (%s, %s, %s, 'succeeded')",
                (payment_id, request.order_id, key),
            )
            return PaymentResponse(
                **request.model_dump(), payment_id=payment_id, status="succeeded"
            )
