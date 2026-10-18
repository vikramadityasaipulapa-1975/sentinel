-- Preserve already-applied migration 009; strengthen execution/decision fencing additively.
ALTER TABLE sentinel_api.remediation_actions ADD CONSTRAINT remediation_started_link CHECK((status IN ('EXECUTING','VERIFIED','FAILED','UNVERIFIED'))=(started_at IS NOT NULL));
ALTER TABLE sentinel_api.remediation_actions ADD CONSTRAINT remediation_decision_link CHECK((decided_by IS NOT NULL)=(decided_at IS NOT NULL AND approver_token_version IS NOT NULL));
CREATE OR REPLACE FUNCTION sentinel_api.guard_remediation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Action history is append-only'; END IF;
    IF ROW(NEW.id,NEW.incident_id,NEW.requested_by,NEW.idempotency_key,NEW.project,NEW.action,NEW.binding_json,NEW.created_at,NEW.expires_at)
       IS DISTINCT FROM ROW(OLD.id,OLD.incident_id,OLD.requested_by,OLD.idempotency_key,OLD.project,OLD.action,OLD.binding_json,OLD.created_at,OLD.expires_at)
       OR NOT ((OLD.status='PENDING' AND NEW.status IN ('APPROVED','REJECTED','EXPIRED'))
         OR (OLD.status='APPROVED' AND NEW.status IN ('EXECUTING','EXPIRED','CANCELLED'))
         OR (OLD.status='EXECUTING' AND NEW.status IN ('VERIFIED','FAILED','UNVERIFIED'))) THEN
       RAISE EXCEPTION 'Invalid or immutable action transition';
    END IF;
    IF OLD.status<>'PENDING' AND NEW.status<>'EXPIRED' AND
       ROW(NEW.decided_by,NEW.approver_token_version,NEW.decided_at) IS DISTINCT FROM ROW(OLD.decided_by,OLD.approver_token_version,OLD.decided_at) THEN
       RAISE EXCEPTION 'Decision identity is immutable';
    END IF;
    IF OLD.execution_token IS NOT NULL AND (NEW.execution_token IS DISTINCT FROM OLD.execution_token OR NEW.started_at IS DISTINCT FROM OLD.started_at) THEN
       RAISE EXCEPTION 'Execution identity is immutable';
    END IF;
    RETURN NEW;
END $$;
