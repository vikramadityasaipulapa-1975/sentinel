CREATE TABLE sentinel_api.investigations (
    id uuid PRIMARY KEY,
    position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    incident_id uuid NOT NULL REFERENCES sentinel_api.incidents(id),
    requested_by uuid NOT NULL REFERENCES sentinel_api.users(id),
    idempotency_key uuid NOT NULL,
    status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    lease_token uuid,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    started_at timestamptz,
    finished_at timestamptz,
    result_json jsonb,
    error_json jsonb,
    CONSTRAINT investigation_request_key UNIQUE (requested_by, idempotency_key),
    CHECK ((status='RUNNING') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
    CHECK ((status IN ('COMPLETED','PARTIAL','FAILED')) = (finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX investigations_one_active ON sentinel_api.investigations (incident_id) WHERE status IN ('QUEUED','RUNNING');
CREATE INDEX investigations_incident_position ON sentinel_api.investigations (incident_id, position DESC);

CREATE TABLE sentinel_api.investigation_outbox (
    investigation_id uuid PRIMARY KEY REFERENCES sentinel_api.investigations(id),
    next_dispatch_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    dispatched_at timestamptz
);
CREATE INDEX investigation_outbox_due ON sentinel_api.investigation_outbox (next_dispatch_at);

ALTER TABLE sentinel_api.incident_events ADD COLUMN investigation_id uuid REFERENCES sentinel_api.investigations(id);
ALTER TABLE sentinel_api.incident_events DROP CONSTRAINT incident_events_type_check;
ALTER TABLE sentinel_api.incident_events ADD CONSTRAINT incident_events_type_check CHECK (type IN ('CREATED','STATUS_CHANGED','INVESTIGATION'));
ALTER TABLE sentinel_api.incident_events ADD CONSTRAINT incident_event_investigation_link CHECK ((type='INVESTIGATION') = (investigation_id IS NOT NULL));
CREATE UNIQUE INDEX investigation_event_once ON sentinel_api.incident_events (investigation_id, (payload_json->>'event'), (payload_json->>'attempt')) WHERE investigation_id IS NOT NULL;
