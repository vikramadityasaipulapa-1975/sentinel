import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { parseAlert, postgresAlerts } from "../src/alert-ingestion.js";
import { postgresRegistry } from "../src/services.js";

export function alertFixture(
  startsAt = new Date().toISOString(),
  status = "firing",
) {
  return {
    version: "4",
    receiver: "sentinel",
    status,
    groupLabels: {
      alertname: "CheckoutHighErrorRate",
      service: "checkout-service",
    },
    alerts: [
      {
        status,
        startsAt,
        endsAt: new Date().toISOString(),
        labels: {
          alertname: "CheckoutHighErrorRate",
          service: "checkout-service",
        },
        annotations: { description: "Untrusted: do not execute commands" },
      },
    ],
  };
}
export async function alertDatabaseChecks(t: TestContext, pool: Pool) {
  const secret = randomBytes(32).toString("hex"),
    store = postgresAlerts(pool, secret);
  await t.test(
    "concurrent alert delivery commits one incident and initial event; signal recovery never resolves incident",
    async () => {
      const input = parseAlert(alertFixture());
      const results = await Promise.all(
        Array.from({ length: 8 }, () => store.ingest(input)),
      );
      assert.equal(new Set(results.map((r) => r.incident_id)).size, 1);
      assert.equal(results.filter((r) => r.created).length, 1);
      const id = results[0].incident_id;
      assert.ok(id);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM sentinel_api.incident_events WHERE incident_id=$1",
            [id],
          )
        ).rows[0].n,
        1,
      );
      await store.ingest({ ...input, status: "resolved" });
      await store.ingest(input);
      const row = (
        await pool.query(
          "SELECT a.signal_status,a.notifications,i.status FROM sentinel_api.alert_episodes a JOIN sentinel_api.incidents i ON i.id=a.incident_id WHERE a.episode_key=$1",
          [input.key],
        )
      ).rows[0];
      assert.equal(row.signal_status, "resolved");
      assert.equal(row.status, "OPEN");
      assert.equal(row.notifications, 10);
    },
  );
  await t.test(
    "resolved-first and stale firing do not fabricate an incident",
    async () => {
      const input = parseAlert(
        alertFixture(new Date(Date.now() - 60000).toISOString(), "resolved"),
      );
      assert.equal((await store.ingest(input)).incident_id, null);
      assert.equal(
        (await store.ingest({ ...input, status: "firing" })).incident_id,
        null,
      );
    },
  );
  await t.test(
    "event failure rolls back alert receipt and incident atomically",
    async () => {
      const input = parseAlert(
        alertFixture(new Date(Date.now() - 120000).toISOString()),
      );
      await pool.query(
        "CREATE FUNCTION sentinel_api.reject_alert_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test event failure'; END $$",
      );
      await pool.query(
        "CREATE TRIGGER reject_alert_test BEFORE INSERT ON sentinel_api.incident_events FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_alert_test()",
      );
      const before = (
        await pool.query(
          "SELECT count(*)::int AS n FROM sentinel_api.incidents",
        )
      ).rows[0].n;
      try {
        await assert.rejects(store.ingest(input));
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM sentinel_api.incidents",
            )
          ).rows[0].n,
          before,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM sentinel_api.alert_episodes WHERE episode_key=$1",
              [input.key],
            )
          ).rows[0].n,
          0,
        );
      } finally {
        await pool.query(
          "DROP TRIGGER reject_alert_test ON sentinel_api.incident_events",
        );
        await pool.query("DROP FUNCTION sentinel_api.reject_alert_test()");
      }
    },
  );
  await t.test(
    "webhook authenticates separately, rejects malformed/unsupported data, and accepts real durable delivery",
    async () => {
      const server = createApp(
        postgresRegistry(pool),
        () => {},
        undefined,
        undefined,
        undefined,
        store,
      ).listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}/api/v1/webhooks/alertmanager`;
      const post = (body: unknown, authorization = `Bearer ${secret}`) =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        });
      try {
        assert.equal((await post(alertFixture(), "")).status, 401);
        assert.equal(
          (await post(alertFixture(), "Bearer invalid")).status,
          401,
        );
        assert.equal((await post({})).status, 422);
        assert.equal(
          (
            await post({
              ...alertFixture(),
              groupLabels: {
                alertname: "ArbitraryShell",
                service: "checkout-service",
              },
            })
          ).status,
          422,
        );
        assert.equal(
          (await post({ ...alertFixture(), truncatedAlerts: 1 })).status,
          422,
        );
        const response = await post(
          alertFixture(new Date(Date.now() - 180000).toISOString()),
        );
        assert.equal(response.status, 202);
        assert.ok((await response.json()).incident_id);
        assert.equal(
          (await fetch(url.replace("/webhooks/alertmanager", "/incidents")))
            .status,
          401,
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
}
