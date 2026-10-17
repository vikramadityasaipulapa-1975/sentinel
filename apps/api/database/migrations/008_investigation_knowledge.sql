CREATE TABLE sentinel_api.investigation_knowledge (
    investigation_id uuid PRIMARY KEY REFERENCES sentinel_api.investigation_reports(investigation_id),
    context_json jsonb NOT NULL CHECK (jsonb_typeof(context_json)='object'),
    canonical_json text NOT NULL CHECK (octet_length(canonical_json)<=16384 AND canonical_json::jsonb=context_json),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER investigation_knowledge_immutable BEFORE UPDATE OR DELETE ON sentinel_api.investigation_knowledge
FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_evidence_mutation();
