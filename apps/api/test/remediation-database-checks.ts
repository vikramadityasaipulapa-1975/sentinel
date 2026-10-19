import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { TestContext } from "node:test";
import { createUser } from "../src/auth-store.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresRemediations } from "../src/remediation-repository.js";
import { ACTION, SANDBOX } from "../src/remediation-policy.js";

export async function remediationDatabaseChecks(t: TestContext, pool: Pool) {
  const store = postgresRemediations(pool);
  const op = await createUser(
    pool,
    "action-op@example.test",
    randomUUID(),
    "OPERATOR",
  );
  const admin = await createUser(
    pool,
    "action-admin@example.test",
    randomUUID(),
    "ADMIN",
  );
  const viewer = await createUser(
    pool,
    "action-viewer@example.test",
    randomUUID(),
    "VIEWER",
  );
  const incident = await postgresIncidents(pool).create({
    service_id: "22222222-2222-4222-8222-222222222222",
    title: "DEMO: sandbox remediation",
    severity: "HIGH",
  });
  const binding = {
    project: SANDBOX,
    container_id: "a".repeat(64),
    current_image: "sha256:" + "b".repeat(64),
    current_version: "payment-v3-error",
    target_image: "sha256:" + "c".repeat(64),
    target_version: "payment-v1",
  };
  await pool.query(
    "INSERT INTO sentinel_api.sandbox_binding(project,binding_json) VALUES ($1,$2)",
    [SANDBOX, binding],
  );
  const request = {
    action: ACTION,
    incident_id: incident.id,
    idempotency_key: randomUUID(),
  };
  let id = "";
  await t.test(
    "action proposal replay is durable; viewers and extra commands are rejected",
    async () => {
      assert.equal((await store.preview(request)).execution_performed, false);
      await assert.rejects(store.propose(request, viewer), { status: 403 });
      await assert.rejects(
        store.propose({ ...request, command: "rollback" }, op),
      );
      const rows = await Promise.all([
        store.propose(request, op),
        store.propose(request, op),
      ]);
      assert.equal(rows[0].id, rows[1].id);
      id = rows[0].id;
      await assert.rejects(
        store.propose({ ...request, idempotency_key: randomUUID() }, op),
        { status: 409 },
      );
    },
  );
  await t.test(
    "only ADMIN decides; concurrent duplicate approvals create one audit decision",
    async () => {
      await assert.rejects(store.decide(id, "APPROVE", op), { status: 403 });
      await assert.rejects(store.decide(id, "APPROVE", viewer), {
        status: 403,
      });
      const rows = await Promise.all([
        store.decide(id, "APPROVE", admin),
        store.decide(id, "APPROVE", admin),
      ]);
      assert.ok(rows.every((row) => row.status === "APPROVED"));
      const saved = await store.get(id);
      assert.equal(saved.events.length, 2);
      assert.equal(
        (await store.decide(id, "REJECT", admin)).status,
        "APPROVED",
      );
      await assert.rejects(
        pool.query(
          "UPDATE sentinel_api.remediation_actions SET binding_json='{}' WHERE id=$1",
          [id],
        ),
      );
      await assert.rejects(
        pool.query(
          "DELETE FROM sentinel_api.remediation_events WHERE action_id=$1",
          [id],
        ),
        /append-only/,
      );
      await assert.rejects(
        pool.query(
          "UPDATE sentinel_api.remediation_events SET observations='{}' WHERE action_id=$1",
          [id],
        ),
        /append-only/,
      );
      await assert.rejects(
        pool.query("DELETE FROM sentinel_api.remediation_actions WHERE id=$1", [
          id,
        ]),
        /append-only/,
      );
      await assert.rejects(
        pool.query(
          "UPDATE sentinel_api.remediation_actions SET status='CANCELLED',decided_by=$2 WHERE id=$1",
          [id, op],
        ),
        /Decision identity is immutable/,
      );
      const history = await postgresIncidents(pool).events(incident.id, {
        limit: 20,
      });
      assert.ok(history.events.some((event) => event.type === "REMEDIATION"));
    },
  );
  // These are policy/transaction fixtures; no executor is started.
  await pool.query(
    "UPDATE sentinel_api.remediation_actions SET status='CANCELLED' WHERE id=$1",
    [id],
  );
  await t.test(
    "rejected decisions remain terminal and role revocation is read live",
    async () => {
      const next = await store.propose(
        { ...request, idempotency_key: randomUUID() },
        op,
      );
      assert.equal(
        (await store.decide(next.id, "REJECT", admin)).status,
        "REJECTED",
      );
      assert.equal(
        (await store.decide(next.id, "APPROVE", admin)).status,
        "REJECTED",
      );
      await pool.query(
        "UPDATE sentinel_api.users SET role='VIEWER' WHERE id=$1",
        [admin],
      );
      await assert.rejects(store.decide(next.id, "APPROVE", admin), {
        status: 403,
      });
    },
  );
  await t.test(
    "expired approval requests do not approve; audit failure rolls back proposals",
    async () => {
      await pool.query(
        "UPDATE sentinel_api.users SET role='ADMIN' WHERE id=$1",
        [admin],
      );
      const expired = randomUUID();
      await pool.query(
        "INSERT INTO sentinel_api.remediation_actions(id,incident_id,requested_by,idempotency_key,project,action,binding_json,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,statement_timestamp()-interval '2 minutes',statement_timestamp()-interval '1 minute')",
        [expired, incident.id, op, randomUUID(), SANDBOX, ACTION, binding],
      );
      await assert.rejects(
        store.decide(expired, "APPROVE", admin, {
          version: 999,
          expires_at: Math.floor(Date.now() / 1000) + 60,
        }),
        { status: 403 },
      );
      await assert.rejects(
        store.decide(expired, "APPROVE", admin, { version: 0, expires_at: 1 }),
        { status: 403 },
      );
      assert.equal(
        (await store.decide(expired, "APPROVE", admin)).status,
        "EXPIRED",
      );
      const key = randomUUID();
      await pool.query(
        "CREATE FUNCTION sentinel_api.fail_action_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER fail_action_audit_test BEFORE INSERT ON sentinel_api.remediation_events FOR EACH ROW EXECUTE FUNCTION sentinel_api.fail_action_audit_test()",
      );
      try {
        await assert.rejects(
          store.propose({ ...request, idempotency_key: key }, op),
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM sentinel_api.remediation_actions WHERE idempotency_key=$1",
              [key],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await pool.query(
          "DROP TRIGGER fail_action_audit_test ON sentinel_api.remediation_events; DROP FUNCTION sentinel_api.fail_action_audit_test()",
        );
      }
    },
  );
  await pool.query(
    "DELETE FROM sentinel_api.sandbox_binding WHERE project=$1",
    [SANDBOX],
  );
}
