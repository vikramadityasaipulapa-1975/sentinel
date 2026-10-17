CREATE TABLE sentinel_api.evidence_snapshots (
    position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    id uuid PRIMARY KEY,
    investigation_id uuid NOT NULL REFERENCES sentinel_api.investigations(id),
    attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
    source text NOT NULL CHECK (source IN ('prometheus','loki','deployments','calculations')),
    status text NOT NULL CHECK (status IN ('OK','EMPTY','UNAVAILABLE','INVALID','PARTIAL','STALE')),
    collected_at timestamptz NOT NULL,
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL CHECK (window_end>window_start AND window_end-window_start<=interval '30 minutes'),
    payload_json jsonb NOT NULL,
    canonical_json text NOT NULL CHECK (octet_length(canonical_json)<=131072 AND canonical_json::jsonb=payload_json),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    UNIQUE (investigation_id,attempt,source)
);
CREATE INDEX evidence_snapshots_investigation_position ON sentinel_api.evidence_snapshots(investigation_id,position DESC);
CREATE FUNCTION sentinel_api.reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Evidence snapshots are append-only';
END $$;
CREATE TRIGGER evidence_snapshots_immutable BEFORE UPDATE OR DELETE ON sentinel_api.evidence_snapshots
FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_evidence_mutation();
