CREATE TABLE demo_orders (
    id uuid PRIMARY KEY,
    amount_minor integer NOT NULL CHECK (amount_minor BETWEEN 1 AND 100000000),
    currency text NOT NULL CHECK (currency IN ('INR', 'USD')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE demo_payments (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL UNIQUE REFERENCES demo_orders(id),
    idempotency_key uuid NOT NULL UNIQUE,
    status text NOT NULL CHECK (status = 'succeeded'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX demo_orders_created_at_idx ON demo_orders(created_at);
