CREATE TABLE sentinel_api.sandbox_binding (
    project text PRIMARY KEY CHECK (project='sentinel-remediation-sandbox'),
    binding_json jsonb NOT NULL CHECK (jsonb_typeof(binding_json)='object'),
    registered_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TABLE sentinel_api.remediation_actions (
    id uuid PRIMARY KEY,
    incident_id uuid NOT NULL REFERENCES sentinel_api.incidents(id),
    requested_by uuid NOT NULL REFERENCES sentinel_api.users(id),
    idempotency_key uuid NOT NULL,
    project text NOT NULL CHECK(project='sentinel-remediation-sandbox'),
    action text NOT NULL CHECK(action='ROLLBACK_SANDBOX_PAYMENT'),
    binding_json jsonb NOT NULL CHECK(jsonb_typeof(binding_json)='object'),
    status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED','EXECUTING','VERIFIED','FAILED','UNVERIFIED')),
    decided_by uuid REFERENCES sentinel_api.users(id),
    approver_token_version integer,
    execution_token uuid,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    expires_at timestamptz NOT NULL DEFAULT (statement_timestamp()+interval '10 minutes'),
    decided_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    result_json jsonb,
    UNIQUE(requested_by,idempotency_key),
    CHECK(expires_at>created_at AND expires_at<=created_at+interval '10 minutes'),
    CHECK((status IN ('APPROVED','REJECTED','EXECUTING','VERIFIED','FAILED','UNVERIFIED','CANCELLED')) = (decided_by IS NOT NULL)),
    CHECK((status IN ('EXECUTING','VERIFIED','FAILED','UNVERIFIED')) = (execution_token IS NOT NULL)),
    CHECK((status IN ('VERIFIED','FAILED','UNVERIFIED')) = (finished_at IS NOT NULL))
);
CREATE UNIQUE INDEX remediation_one_active_sandbox ON sentinel_api.remediation_actions(project) WHERE status IN ('PENDING','APPROVED','EXECUTING');
CREATE INDEX remediation_incident ON sentinel_api.remediation_actions(incident_id,created_at DESC);
CREATE TABLE sentinel_api.remediation_events (
    sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    action_id uuid NOT NULL REFERENCES sentinel_api.remediation_actions(id),
    status text NOT NULL,
    actor_id uuid REFERENCES sentinel_api.users(id),
    observations jsonb,
    created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER remediation_events_immutable BEFORE UPDATE OR DELETE ON sentinel_api.remediation_events
FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_evidence_mutation();
CREATE FUNCTION sentinel_api.guard_remediation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Action history is append-only'; END IF;
    IF ROW(NEW.id,NEW.incident_id,NEW.requested_by,NEW.idempotency_key,NEW.project,NEW.action,NEW.binding_json,NEW.created_at,NEW.expires_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.incident_id,OLD.requested_by,OLD.idempotency_key,OLD.project,OLD.action,OLD.binding_json,OLD.created_at,OLD.expires_at)
       OR NOT ((OLD.status='PENDING' AND NEW.status IN ('APPROVED','REJECTED','EXPIRED'))
         OR (OLD.status='APPROVED' AND NEW.status IN ('EXECUTING','EXPIRED','CANCELLED'))
         OR (OLD.status='EXECUTING' AND NEW.status IN ('VERIFIED','FAILED','UNVERIFIED'))) THEN
       RAISE EXCEPTION 'Invalid or immutable action transition';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER remediation_guard BEFORE UPDATE OR DELETE ON sentinel_api.remediation_actions
FOR EACH ROW EXECUTE FUNCTION sentinel_api.guard_remediation();
ALTER TABLE sentinel_api.incident_events ADD COLUMN remediation_id uuid REFERENCES sentinel_api.remediation_actions(id);
ALTER TABLE sentinel_api.incident_events DROP CONSTRAINT incident_events_type_check;
ALTER TABLE sentinel_api.incident_events ADD CONSTRAINT incident_events_type_check CHECK(type IN ('CREATED','STATUS_CHANGED','INVESTIGATION','REMEDIATION'));
ALTER TABLE sentinel_api.incident_events ADD CONSTRAINT incident_event_remediation_link CHECK ((type='REMEDIATION')=(remediation_id IS NOT NULL));
