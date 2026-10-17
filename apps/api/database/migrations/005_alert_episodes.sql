CREATE TABLE sentinel_api.alert_episodes (
    episode_key text PRIMARY KEY CHECK (episode_key ~ '^[0-9a-f]{64}$'),
    service_id uuid NOT NULL REFERENCES sentinel_api.services(id),
    alert_name text NOT NULL CHECK (alert_name = 'CheckoutHighErrorRate'),
    starts_at timestamptz NOT NULL,
    signal_status text NOT NULL CHECK (signal_status IN ('firing', 'resolved')),
    incident_id uuid UNIQUE REFERENCES sentinel_api.incidents(id),
    notifications integer NOT NULL DEFAULT 1 CHECK (notifications BETWEEN 1 AND 1000000000),
    last_seen_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (service_id, alert_name, starts_at)
);
