import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { postgresRegistry } from "../src/services.js";
import { createUser, postgresUsers } from "../src/auth-store.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresInvestigations } from "../src/investigations.js";
import { sources, type Evidence } from "../src/evidence.js";
import { collectEvidence, evidenceConfig } from "../src/evidence.js";
import {
  createPublisher,
  dispatchOnce,
  startInvestigationWorker,
} from "../src/investigation-queue.js";

export async function evidenceDatabaseChecks(t: TestContext, pool: Pool) {
  const store = postgresInvestigations(pool);
  const password = randomBytes(24).toString("hex");
  const actor = await createUser(
    pool,
    "evidence-test@example.test",
    password,
    "OPERATOR",
  );
  const incident = await postgresIncidents(pool).create({
    service_id: "11111111-1111-4111-8111-111111111111",
    title: "DEMO: evidence verification",
    severity: "HIGH",
  });
  const run = await store.enqueue(incident.id, actor, randomUUID());
  const claim = await store.claim(run.id);
  assert.ok(claim);
  const end = new Date(),
    start = new Date(end.getTime() - 600000);
  const fixture: Evidence[] = sources.map((source) => ({
    source,
    status: source === "deployments" ? "EMPTY" : "OK",
    window: {
      service: "checkout-service",
      start: start.toISOString(),
      end: end.toISOString(),
    },
    collected_at: end.toISOString(),
    locator: { kind: "synthetic-test-fixture" },
    data: { sample: 1 },
  }));
  await t.test("stale completion cannot persist evidence", async () => {
    assert.equal(
      await store.finish(run.id, randomUUID(), true, fixture),
      false,
    );
    assert.equal((await store.evidence(run.id, {})).snapshots.length, 0);
  });
  await t.test(
    "snapshot failure rolls back all snapshots and terminal event",
    async () => {
      await pool.query(
        "CREATE FUNCTION sentinel_api.reject_snapshot_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source='loki' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_snapshot_test BEFORE INSERT ON sentinel_api.evidence_snapshots FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_snapshot_test()",
      );
      try {
        await assert.rejects(store.finish(run.id, claim.token, true, fixture));
        assert.equal((await store.evidence(run.id, {})).snapshots.length, 0);
        assert.equal((await store.get(run.id)).status, "RUNNING");
      } finally {
        await pool.query(
          "DROP TRIGGER reject_snapshot_test ON sentinel_api.evidence_snapshots; DROP FUNCTION sentinel_api.reject_snapshot_test()",
        );
      }
    },
  );
  await t.test(
    "fenced completion stores four immutable hashes with paged exact payloads",
    async () => {
      assert.equal(
        await store.finish(run.id, claim.token, true, fixture),
        true,
      );
      assert.equal((await store.get(run.id)).status, "PARTIAL");
      assert.equal(
        (await store.get(run.id)).result?.mode,
        "deterministic-evidence",
      );
      const first = await store.evidence(run.id, { limit: "2" });
      assert.equal(first.snapshots.length, 2);
      assert.ok(first.next_cursor);
      const second = await store.evidence(run.id, {
        limit: "2",
        cursor: first.next_cursor,
      });
      assert.equal(second.snapshots.length, 2);
      assert.equal(second.next_cursor, null);
      assert.ok(
        [...first.snapshots, ...second.snapshots].every(
          (row) =>
            row.hash_verified && (row.evidence as Evidence).data.sample === 1,
        ),
      );
      for (const sql of [
        "UPDATE sentinel_api.evidence_snapshots SET status='INVALID' WHERE investigation_id=$1",
        "DELETE FROM sentinel_api.evidence_snapshots WHERE investigation_id=$1",
      ])
        await assert.rejects(pool.query(sql, [run.id]), /append-only/);
      assert.equal(
        await store.finish(run.id, claim.token, true, fixture),
        false,
      );
      const rerun = await store.enqueue(incident.id, actor, randomUUID());
      const next = await store.claim(rerun.id);
      assert.ok(next);
      await store.finish(rerun.id, next.token, true, fixture);
      assert.equal((await store.evidence(run.id, {})).snapshots.length, 4);
      assert.equal((await store.evidence(rerun.id, {})).snapshots.length, 4);
    },
  );
  await t.test(
    "authenticated evidence HTTP replay survives API reconstruction",
    async () => {
      const auth = createAuth(postgresUsers(pool), randomBytes(32));
      const token = (
        await auth.login(
          "evidence-test@example.test",
          password,
          "evidence-test",
        )
      ).access_token;
      let original: unknown;
      for (let cycle = 0; cycle < 2; cycle++) {
        const server = createApp(
          postgresRegistry(pool),
          () => {},
          postgresIncidents(pool),
          auth,
          postgresInvestigations(pool),
        ).listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        try {
          const response = await fetch(
            `http://127.0.0.1:${address.port}/api/v1/investigations/${run.id}/evidence`,
            { headers: { authorization: "Bearer " + token } },
          );
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.equal(body.snapshots.length, 4);
          assert.ok(
            body.snapshots.every(
              (row: { hash_verified: boolean }) => row.hash_verified,
            ),
          );
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
  await t.test(
    "expired worker cannot append evidence after a replacement claim",
    async () => {
      const other = await postgresIncidents(pool).create({
        service_id: "11111111-1111-4111-8111-111111111111",
        title: "DEMO: evidence lease expiry",
        severity: "HIGH",
      });
      const pending = await store.enqueue(other.id, actor, randomUUID());
      const old = await store.claim(pending.id);
      assert.ok(old);
      await pool.query(
        "UPDATE sentinel_api.investigations SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
        [pending.id],
      );
      assert.equal(
        await store.finish(pending.id, old.token, true, fixture),
        false,
      );
      const replacement = await store.claim(pending.id);
      assert.ok(replacement);
      assert.equal(
        await store.finish(pending.id, old.token, true, fixture),
        false,
      );
      assert.equal((await store.evidence(pending.id, {})).snapshots.length, 0);
      assert.equal(
        await store.finish(pending.id, replacement.token, true, fixture),
        true,
      );
    },
  );
  if (process.env.TEST_EVIDENCE_SECRET)
    await t.test(
      "real Python collector and BullMQ worker persist live source evidence",
      async () => {
        const settings = {
          SENTINEL_EVIDENCE_URL: "http://127.0.0.1:8001",
          SENTINEL_EVIDENCE_SECRET: process.env.TEST_EVIDENCE_SECRET,
        };
        const config = evidenceConfig(settings);
        assert.ok(config);
        const live = await collectEvidence(
          config,
          "checkout-service",
          start.toISOString(),
          end.toISOString(),
        );
        assert.ok(
          ["OK", "PARTIAL"].includes(
            live.find((row) => row.source === "prometheus")!.status,
          ),
        );
        const previousUrl = process.env.SENTINEL_EVIDENCE_URL,
          previousSecret = process.env.SENTINEL_EVIDENCE_SECRET;
        process.env.SENTINEL_EVIDENCE_URL = settings.SENTINEL_EVIDENCE_URL;
        process.env.SENTINEL_EVIDENCE_SECRET =
          settings.SENTINEL_EVIDENCE_SECRET;
        let worker = startInvestigationWorker(
          pool,
          process.env.TEST_API_REDIS_URL!,
        );
        const publisher = createPublisher(process.env.TEST_API_REDIS_URL!);
        try {
          if (publisher.redis.status !== "ready")
            await once(publisher.redis, "ready");
          const pending = await store.enqueue(incident.id, actor, randomUUID());
          await dispatchOnce(pool, publisher.add);
          const deadline = Date.now() + 20000;
          while (
            !["COMPLETED", "PARTIAL", "FAILED"].includes(
              (await store.get(pending.id)).status,
            ) &&
            Date.now() < deadline
          )
            await new Promise((r) => setTimeout(r, 100));
          assert.ok(
            ["COMPLETED", "PARTIAL"].includes(
              (await store.get(pending.id)).status,
            ),
          );
          assert.equal(
            (await store.evidence(pending.id, {})).snapshots.length,
            4,
          );
          const savedReport = await store.report(pending.id);
          assert.equal(savedReport.hash_verified, true);
          assert.equal(savedReport.report.ai_performed, false);
          assert.equal(savedReport.report.model_status, "DISABLED");
          assert.equal(
            (await store.get(pending.id)).result?.mode,
            "hypothesis-report",
          );
          await worker.close();
          process.env.SENTINEL_EVIDENCE_SECRET = "b".repeat(64);
          worker = startInvestigationWorker(
            pool,
            process.env.TEST_API_REDIS_URL!,
          );
          const denied = await store.enqueue(incident.id, actor, randomUUID());
          await dispatchOnce(pool, publisher.add);
          const failureDeadline = Date.now() + 20000;
          while (
            (await store.get(denied.id)).status !== "FAILED" &&
            Date.now() < failureDeadline
          )
            await new Promise((r) => setTimeout(r, 100));
          const failed = await store.get(denied.id);
          assert.equal(failed.status, "FAILED");
          assert.equal(failed.error?.code, "EVIDENCE_COLLECTION_FAILED");
          assert.equal(
            (await store.evidence(denied.id, {})).snapshots.length,
            0,
          );
        } finally {
          await worker.close();
          await publisher.close();
          if (previousUrl === undefined)
            delete process.env.SENTINEL_EVIDENCE_URL;
          else process.env.SENTINEL_EVIDENCE_URL = previousUrl;
          if (previousSecret === undefined)
            delete process.env.SENTINEL_EVIDENCE_SECRET;
          else process.env.SENTINEL_EVIDENCE_SECRET = previousSecret;
        }
      },
    );
}
