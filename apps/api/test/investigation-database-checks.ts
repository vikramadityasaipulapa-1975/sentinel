import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { createUser, postgresUsers } from "../src/auth-store.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresInvestigations } from "../src/investigations.js";
import {
  createPublisher,
  dispatchOnce,
  startInvestigationWorker,
} from "../src/investigation-queue.js";
import { postgresRegistry } from "../src/services.js";

async function waitFor(check: () => Promise<boolean>, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Investigation check timed out");
}
export async function investigationDatabaseChecks(t: TestContext, pool: Pool) {
  const store = postgresInvestigations(pool),
    incidents = postgresIncidents(pool);
  const password = randomBytes(24).toString("hex");
  const operator = await createUser(
    pool,
    "queue-operator@example.test",
    password,
    "OPERATOR",
  );
  await createUser(pool, "queue-viewer@example.test", password, "VIEWER");
  const makeIncident = () =>
    incidents.create({
      service_id: "11111111-1111-4111-8111-111111111111",
      title: "DEMO: queue verification",
      severity: "HIGH",
    });
  const newRun = async () =>
    store.enqueue((await makeIncident()).id, operator, randomUUID());
  await t.test(
    "concurrent enqueue replays one durable request and rejects active/key conflicts",
    async () => {
      const incident = await makeIncident(),
        key = randomUUID();
      const runs = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.enqueue(incident.id, operator, key),
        ),
      );
      assert.equal(new Set(runs.map((run) => run.id)).size, 1);
      assert.equal(runs[0].status, "QUEUED");
      await assert.rejects(store.enqueue(incident.id, operator, randomUUID()));
      await assert.rejects(
        store.enqueue((await makeIncident()).id, operator, key),
      );
      const claim = await store.claim(runs[0].id);
      assert.ok(claim);
      await store.finish(runs[0].id, claim.token, true);
      assert.equal(
        (await store.enqueue(incident.id, operator, key)).status,
        "COMPLETED",
      );
      const second = await store.enqueue(incident.id, operator, randomUUID());
      const secondClaim = await store.claim(second.id);
      assert.ok(secondClaim);
      await store.finish(second.id, secondClaim.token, true);
      const page = await store.list(incident.id, { limit: "1" });
      assert.equal(page.investigations[0].id, second.id);
      assert.ok(page.next_cursor);
      const last = await store.list(incident.id, {
        limit: "1",
        cursor: page.next_cursor,
      });
      assert.equal(last.investigations[0].id, runs[0].id);
      assert.equal(last.next_cursor, null);
    },
  );
  await t.test(
    "outbox failure rolls back investigation creation and queued event",
    async () => {
      const incident = await makeIncident();
      await pool.query(
        "CREATE FUNCTION sentinel_api.reject_outbox_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER reject_outbox_test BEFORE INSERT ON sentinel_api.investigation_outbox FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_outbox_test()",
      );
      try {
        await assert.rejects(
          store.enqueue(incident.id, operator, randomUUID()),
        );
        assert.equal(
          (await store.list(incident.id, {})).investigations.length,
          0,
        );
        assert.equal(
          (await incidents.events(incident.id, { limit: 100 })).events.length,
          1,
        );
      } finally {
        await pool.query(
          "DROP TRIGGER reject_outbox_test ON sentinel_api.investigation_outbox; DROP FUNCTION sentinel_api.reject_outbox_test()",
        );
      }
    },
  );
  await t.test(
    "expired leases recover with fencing and terminal duplicates cannot change history",
    async () => {
      const run = await newRun(),
        first = await store.claim(run.id);
      assert.ok(first);
      assert.equal(await store.claim(run.id), null);
      await pool.query(
        "UPDATE sentinel_api.investigations SET lease_until=statement_timestamp()-interval '1 second' WHERE id=$1",
        [run.id],
      );
      const second = await store.claim(run.id);
      assert.ok(second);
      assert.notEqual(first.token, second.token);
      assert.equal(await store.finish(run.id, first.token, true), false);
      assert.equal(await store.finish(run.id, second.token, true), true);
      const count = (await incidents.events(run.incident_id, { limit: 100 }))
        .events.length;
      assert.equal(await store.finish(run.id, second.token, true), false);
      assert.equal(
        (await incidents.events(run.incident_id, { limit: 100 })).events.length,
        count,
      );
      assert.equal((await store.get(run.id)).result?.ai_performed, false);
    },
  );
  await t.test(
    "database attempt budget ends in FAILED and failed publication preserves pending work",
    async () => {
      const run = await newRun();
      await assert.rejects(
        dispatchOnce(pool, async () => {
          throw new Error("Redis unavailable fixture");
        }),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM sentinel_api.investigation_outbox WHERE investigation_id=$1",
            [run.id],
          )
        ).rows[0].n,
        1,
      );
      for (let i = 0; i < 3; i++) {
        const claim = await store.claim(run.id);
        assert.ok(claim);
        await store.finish(run.id, claim.token, false);
      }
      assert.equal((await store.get(run.id)).status, "FAILED");
      assert.equal((await store.get(run.id)).attempts, 3);
      assert.equal(await store.claim(run.id), null);
    },
  );
  await t.test(
    "real BullMQ delivery restores a missing job and treats terminal duplicate delivery as a no-op",
    { skip: !process.env.TEST_API_REDIS_URL },
    async () => {
      const publisher = createPublisher(process.env.TEST_API_REDIS_URL!);
      let worker: ReturnType<typeof startInvestigationWorker> | undefined;
      try {
        await waitFor(async () => publisher.redis.status === "ready");
        const run = await newRun();
        await dispatchOnce(pool, publisher.add);
        const job = await publisher.queue.getJob(run.id);
        assert.ok(job);
        await job.remove();
        await pool.query(
          "UPDATE sentinel_api.investigation_outbox SET next_dispatch_at=statement_timestamp() WHERE investigation_id=$1",
          [run.id],
        );
        await dispatchOnce(pool, publisher.add);
        assert.ok(await publisher.queue.getJob(run.id));
        worker = startInvestigationWorker(
          pool,
          process.env.TEST_API_REDIS_URL!,
        );
        await waitFor(
          async () => (await store.get(run.id)).status === "COMPLETED",
        );
        await waitFor(async () => !(await publisher.queue.getJob(run.id)));
        const count = (await incidents.events(run.incident_id, { limit: 100 }))
          .events.length;
        await publisher.add(run.id);
        await waitFor(async () => !(await publisher.queue.getJob(run.id)));
        assert.equal(
          (await incidents.events(run.incident_id, { limit: 100 })).events
            .length,
          count,
        );
      } finally {
        await worker?.close();
        await publisher.close();
      }
    },
  );
  await t.test(
    "real BullMQ failing worker retries only to the persisted three-attempt limit",
    { skip: !process.env.TEST_API_REDIS_URL },
    async () => {
      const publisher = createPublisher(process.env.TEST_API_REDIS_URL!);
      const worker = startInvestigationWorker(
        pool,
        process.env.TEST_API_REDIS_URL!,
        async () => {
          throw new Error("Controlled failure fixture");
        },
      );
      try {
        await waitFor(async () => publisher.redis.status === "ready");
        const run = await newRun();
        await dispatchOnce(pool, publisher.add);
        await waitFor(async () => {
          await dispatchOnce(pool, publisher.add);
          return (await store.get(run.id)).status === "FAILED";
        });
        assert.equal((await store.get(run.id)).attempts, 3);
        assert.equal((await store.get(run.id)).result, null);
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM sentinel_api.investigation_outbox WHERE investigation_id=$1",
              [run.id],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await worker.close();
        await publisher.close();
      }
    },
  );
  await t.test(
    "authenticated enqueue returns 202 without a worker and viewer writes are forbidden",
    async () => {
      const auth = createAuth(postgresUsers(pool), randomBytes(32));
      const token = (
        await auth.login("queue-operator@example.test", password, "queue-test")
      ).access_token;
      const viewer = (
        await auth.login("queue-viewer@example.test", password, "queue-test")
      ).access_token;
      const server = createApp(
        postgresRegistry(pool),
        () => {},
        incidents,
        auth,
        store,
      ).listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const incident = await makeIncident(),
        key = randomUUID(),
        path = `http://127.0.0.1:${address.port}/api/v1/incidents/${incident.id}/investigations`;
      const post = (bearer: string, requestKey: string = key) =>
        fetch(path, {
          method: "POST",
          headers: {
            authorization: "Bearer " + bearer,
            "content-type": "application/json",
            "idempotency-key": requestKey,
          },
          body: "{}",
          signal: AbortSignal.timeout(5000),
        });
      try {
        assert.equal((await post(viewer)).status, 403);
        assert.equal((await post(token, "bad")).status, 422);
        const started = performance.now(),
          response = await post(token);
        assert.equal(response.status, 202);
        assert.ok(performance.now() - started < 3000);
        const run = await response.json();
        assert.equal(run.status, "QUEUED");
        assert.equal((await (await post(token)).json()).id, run.id);
        assert.equal(
          (
            await fetch(
              `http://127.0.0.1:${address.port}/api/v1/investigations/${run.id}`,
              { headers: { authorization: "Bearer " + token } },
            )
          ).status,
          200,
        );
        assert.equal(
          (await store.list(incident.id, {})).investigations.length,
          1,
        );
        const claim = await store.claim(run.id);
        assert.ok(claim);
        await store.finish(run.id, claim.token, true);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    },
  );
}
