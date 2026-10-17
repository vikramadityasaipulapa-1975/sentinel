import { knowledgeFixture } from "./knowledge-fixture.js";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { postgresRegistry } from "../src/services.js";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { TestContext } from "node:test";
import { createUser, postgresUsers } from "../src/auth-store.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresInvestigations } from "../src/investigations.js";
import { reportFixture } from "./report-fixture.js";

export async function reportDatabaseChecks(t: TestContext, pool: Pool) {
  const store = postgresInvestigations(pool);
  const password = randomBytes(24).toString("hex");
  const user = await createUser(
    pool,
    "report-test@example.test",
    password,
    "OPERATOR",
  );
  const incident = await postgresIncidents(pool).create({
    service_id: "11111111-1111-4111-8111-111111111111",
    title: "DEMO: report transaction",
    severity: "HIGH",
  });
  const { report, evidence } = reportFixture();
  const run = await store.enqueue(incident.id, user, randomUUID());
  const claim = await store.claim(run.id, 30);
  assert.ok(claim);
  await t.test(
    "invalid report rolls back snapshots and completion",
    async () => {
      await assert.rejects(
        store.finish(
          run.id,
          claim.token,
          true,
          evidence,
          "WORKFLOW_CHECK_FAILED",
          { ...report, facts: [{ ...report.facts[0], value: 99 }] },
        ),
      );
      assert.equal((await store.get(run.id)).status, "RUNNING");
      assert.equal((await store.evidence(run.id, {})).snapshots.length, 0);
      await assert.rejects(store.report(run.id), { code: "REPORT_NOT_FOUND" });
    },
  );
  await t.test(
    "report insert failure rolls back evidence and terminal event",
    async () => {
      await pool.query(
        "CREATE FUNCTION sentinel_api.reject_report_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER reject_report_test BEFORE INSERT ON sentinel_api.investigation_reports FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_report_test()",
      );
      try {
        await assert.rejects(
          store.finish(
            run.id,
            claim.token,
            true,
            evidence,
            "WORKFLOW_CHECK_FAILED",
            report,
          ),
        );
        assert.equal((await store.evidence(run.id, {})).snapshots.length, 0);
        assert.equal((await store.get(run.id)).status, "RUNNING");
      } finally {
        await pool.query(
          "DROP TRIGGER reject_report_test ON sentinel_api.investigation_reports; DROP FUNCTION sentinel_api.reject_report_test()",
        );
      }
    },
  );
  await t.test(
    "invalid knowledge rolls back report, snapshots and terminal state",
    async () => {
      const context = knowledgeFixture("checkout-errors");
      context.citations[0].passage = "fabricated";
      await assert.rejects(
        store.finish(
          run.id,
          claim.token,
          true,
          evidence,
          "WORKFLOW_CHECK_FAILED",
          report,
          context,
        ),
      );
      assert.equal((await store.evidence(run.id, {})).snapshots.length, 0);
      await assert.rejects(store.report(run.id));
      assert.equal((await store.get(run.id)).status, "RUNNING");
    },
  );
  await t.test(
    "report and exact snapshot citations commit once and reject mutation",
    async () => {
      assert.equal(
        await store.finish(
          run.id,
          claim.token,
          true,
          evidence,
          "WORKFLOW_CHECK_FAILED",
          report,
          knowledgeFixture("checkout-errors"),
        ),
        true,
      );
      const saved = await store.report(run.id);
      assert.equal(saved.hash_verified, true);
      assert.equal(saved.knowledge.hash_verified, true);
      assert.equal(saved.knowledge.citations[0].document_id, "checkout-errors");
      for (const statement of [
        "UPDATE sentinel_api.investigation_knowledge SET sha256=repeat('0',64) WHERE investigation_id=$1",
        "DELETE FROM sentinel_api.investigation_knowledge WHERE investigation_id=$1",
      ])
        await assert.rejects(pool.query(statement, [run.id]), /append-only/);
      assert.equal((await store.get(run.id)).result?.mode, "hypothesis-report");
      const snapshots = (await store.evidence(run.id, {})).snapshots;
      for (const fact of saved.report.facts)
        assert.ok(
          snapshots.some(
            (s) =>
              s.id === fact.snapshot_id && s.sha256 === fact.snapshot_sha256,
          ),
        );
      assert.deepEqual(
        await postgresInvestigations(pool).report(run.id),
        saved,
      );
      for (const statement of [
        "UPDATE sentinel_api.investigation_reports SET attempt=1 WHERE investigation_id=$1",
        "DELETE FROM sentinel_api.investigation_reports WHERE investigation_id=$1",
      ])
        await assert.rejects(pool.query(statement, [run.id]), /append-only/);
      assert.equal(
        await store.finish(
          run.id,
          claim.token,
          true,
          evidence,
          "WORKFLOW_CHECK_FAILED",
          report,
        ),
        false,
      );
    },
  );
  await t.test(
    "report HTTP requires auth, allows viewers and replays unchanged after API reconstruction",
    async () => {
      await createUser(pool, "report-viewer@example.test", password, "VIEWER");
      const auth = createAuth(postgresUsers(pool), randomBytes(32));
      const token = (
        await auth.login(
          "report-viewer@example.test",
          password,
          "report-viewer",
        )
      ).access_token;
      let original: unknown;
      for (let cycle = 0; cycle < 2; cycle++) {
        const server = createApp(
          postgresRegistry(pool),
          () => {},
          postgresIncidents(pool),
          auth,
          store,
        ).listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const url = `http://127.0.0.1:${address.port}/api/v1/investigations/${run.id}/report`;
        try {
          assert.equal((await fetch(url)).status, 401);
          const response = await fetch(url, {
            headers: { authorization: "Bearer " + token },
          });
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.equal(body.hash_verified, true);
          if (cycle === 0) original = body;
          else assert.deepEqual(body, original);
        } finally {
          await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          });
        }
      }
    },
  );
}
