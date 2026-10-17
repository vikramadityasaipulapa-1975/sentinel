CREATE TABLE sentinel_api.investigation_reports (
    investigation_id uuid PRIMARY KEY REFERENCES sentinel_api.investigations(id),
    attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
    report_json jsonb NOT NULL CHECK (jsonb_typeof(report_json)='object'),
    canonical_json text NOT NULL CHECK (octet_length(canonical_json)<=65536 AND canonical_json::jsonb=report_json),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER investigation_reports_immutable BEFORE UPDATE OR DELETE ON sentinel_api.investigation_reports
FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_evidence_mutation();
