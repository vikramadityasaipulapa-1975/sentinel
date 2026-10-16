CREATE TABLE sentinel_api.incidents (
    id uuid PRIMARY KEY,
    list_position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    service_id uuid NOT NULL REFERENCES sentinel_api.services(id),
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    severity text NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'INVESTIGATING', 'MITIGATING', 'RESOLVED', 'CLOSED')),
    started_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    CHECK ((status IN ('RESOLVED', 'CLOSED')) = (resolved_at IS NOT NULL)),
    CHECK (resolved_at IS NULL OR resolved_at >= started_at)
);

CREATE INDEX incidents_status_position ON sentinel_api.incidents (status, list_position DESC);
CREATE INDEX incidents_service_position ON sentinel_api.incidents (service_id, list_position DESC);

CREATE TABLE sentinel_api.incident_events (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id uuid NOT NULL UNIQUE,
    incident_id uuid NOT NULL REFERENCES sentinel_api.incidents(id),
    type text NOT NULL CHECK (type IN ('CREATED', 'STATUS_CHANGED')),
    payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json) = 'object'),
    occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

CREATE INDEX incident_events_incident_sequence ON sentinel_api.incident_events (incident_id, sequence);
