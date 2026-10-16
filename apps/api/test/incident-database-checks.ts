import { domainAuth } from "./auth-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { IncidentError, parseList, type Incident } from "../src/incidents.js";
import { postgresRegistry } from "../src/services.js";

export async function incidentDatabaseChecks(t: TestContext, pool: Pool) {
  const store = postgresIncidents(pool);
  const input = {
    service_id: "11111111-1111-4111-8111-111111111111",
    title: "Integration demo incident",
    severity: "HIGH" as const,
  };
  let incident: Incident;
  await t.test(
    "incident creation commits exactly one initial event and validates output",
    async () => {
      incident = await store.create(input);
      assert.equal(incident.status, "OPEN");
      assert.equal(incident.resolved_at, null);
      assert.equal("list_position" in incident, false);
      assert.deepEqual(await store.get(incident.id), incident);
      const { events } = await store.events(incident.id, { limit: 20 });
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "CREATED");
      assert.deepEqual(events[0].payload, { status: "OPEN" });
      assert.equal(events[0].incident_id, incident.id);
    },
  );
  await t.test(
    "missing service/incident failures create no orphan rows",
    async () => {
      const before = (
        await pool.query(
          "SELECT count(*)::int AS n FROM sentinel_api.incidents",
        )
      ).rows[0].n;
      await assert.rejects(
        store.create({ ...input, service_id: randomUUID() }),
        (error) =>
          error instanceof IncidentError && error.code === "SERVICE_NOT_FOUND",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM sentinel_api.incidents",
          )
        ).rows[0].n,
        before,
      );
      for (const operation of [
        () => store.get(randomUUID()),
        () => store.events(randomUUID(), { limit: 20 }),
        () => store.transition(randomUUID(), "INVESTIGATING"),
      ])
        await assert.rejects(
          operation(),
          (error) => error instanceof IncidentError && error.status === 404,
        );
    },
  );
  await t.test(
    "event failure rolls back incident creation and status changes",
    async () => {
      const before = (
        await pool.query(
          "SELECT count(*)::int AS n FROM sentinel_api.incidents",
        )
      ).rows[0].n;
      // Dedicated test database only: this fixture forces the second write to fail.
      await pool.query(
        "CREATE FUNCTION sentinel_api.reject_test_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced test event failure'; END $$; CREATE TRIGGER reject_test_event BEFORE INSERT ON sentinel_api.incident_events FOR EACH ROW EXECUTE FUNCTION sentinel_api.reject_test_event()",
      );
      try {
        await assert.rejects(
          store.create(input),
          (error) => error instanceof IncidentError && error.status === 503,
        );
        await assert.rejects(
          store.transition(incident.id, "INVESTIGATING"),
          (error) => error instanceof IncidentError && error.status === 503,
        );
        assert.equal((await store.get(incident.id)).status, "OPEN");
        assert.equal(
          (await store.events(incident.id, { limit: 20 })).events.length,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM sentinel_api.incidents",
            )
          ).rows[0].n,
          before,
        );
      } finally {
        await pool.query(
          "DROP TRIGGER reject_test_event ON sentinel_api.incident_events; DROP FUNCTION sentinel_api.reject_test_event()",
        );
      }
    },
  );
  await t.test(
    "concurrent repeated transitions append exactly one status event",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.transition(incident.id, "INVESTIGATING"),
        ),
      );
      assert.ok(results.every((row) => row.status === "INVESTIGATING"));
      const events = (await store.events(incident.id, { limit: 20 })).events;
      assert.equal(events.length, 2);
      assert.equal(events[1].type, "STATUS_CHANGED");
      assert.deepEqual(events[1].payload, {
        from_status: "OPEN",
        to_status: "INVESTIGATING",
      });
      assert.ok(BigInt(events[1].sequence) > BigInt(events[0].sequence));
    },
  );
  await t.test(
    "row lock serializes a competing transition and checks the newly committed status",
    async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT id FROM sentinel_api.incidents WHERE id = $1 FOR UPDATE",
          [incident.id],
        );
        const pending = store.transition(incident.id, "MITIGATING").then(
          (row) => ({ row, error: undefined }),
          (error) => ({ row: undefined, error }),
        );
        let waiting = false;
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          const result = await pool.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM sentinel_api.incidents WHERE id = $1 FOR UPDATE%'",
          );
          if (result.rows[0].n > 0) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(
          waiting,
          true,
          "Competing request must actually wait for the held row lock",
        );
        const updated = await client.query(
          "UPDATE sentinel_api.incidents SET status='RESOLVED', resolved_at=statement_timestamp() WHERE id=$1 RETURNING id",
          [incident.id],
        );
        await client.query(
          "INSERT INTO sentinel_api.incident_events (id, incident_id, type, payload_json) VALUES ($1, $2, 'STATUS_CHANGED', $3)",
          [
            randomUUID(),
            updated.rows[0].id,
            JSON.stringify({
              from_status: "INVESTIGATING",
              to_status: "RESOLVED",
            }),
          ],
        );
        await client.query("COMMIT");
        const outcome = await pending;
        assert.ok(
          outcome.error instanceof IncidentError &&
            outcome.error.status === 409,
        );
        assert.equal((await store.get(incident.id)).status, "RESOLVED");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );
  await t.test(
    "resolve, reopen and close preserve timestamp rules and terminal status",
    async () => {
      assert.ok((await store.get(incident.id)).resolved_at);
      assert.equal(
        (await store.transition(incident.id, "INVESTIGATING")).resolved_at,
        null,
      );
      await store.transition(incident.id, "MITIGATING");
      const resolved = await store.transition(incident.id, "RESOLVED");
      const closed = await store.transition(incident.id, "CLOSED");
      assert.equal(closed.resolved_at, resolved.resolved_at);
      const count = (await store.events(incident.id, { limit: 100 })).events
        .length;
      assert.deepEqual(await store.transition(incident.id, "CLOSED"), closed);
      await assert.rejects(
        store.transition(incident.id, "OPEN"),
        (error) => error instanceof IncidentError && error.status === 409,
      );
      assert.equal(
        (await store.events(incident.id, { limit: 100 })).events.length,
        count,
      );
      assert.ok(
        Date.parse(closed.resolved_at!) >= Date.parse(closed.started_at),
      );
    },
  );
  await t.test(
    "incident filters and stable cursor pages neither duplicate nor skip records",
    async () => {
      const second = await store.create(input);
      const third = await store.create({
        ...input,
        service_id: "22222222-2222-4222-8222-222222222222",
        severity: "LOW",
      });
      const firstPage = await store.list({ limit: 1 });
      assert.equal(firstPage.incidents[0].id, third.id);
      assert.ok(firstPage.next_cursor);
      const next = await store.list(
        parseList({ limit: "1", cursor: firstPage.next_cursor }),
      );
      assert.equal(next.incidents[0].id, second.id);
      assert.ok(next.next_cursor);
      const last = await store.list(
        parseList({ limit: "1", cursor: next.next_cursor }),
      );
      assert.equal(last.incidents[0].id, incident.id);
      assert.equal(last.next_cursor, null);
      assert.deepEqual(
        (
          await store.list({
            limit: 100,
            status: "CLOSED",
            service_id: input.service_id,
          })
        ).incidents.map((row) => row.id),
        [incident.id],
      );
      assert.equal(
        (await store.list({ limit: 20, service_id: randomUUID() })).incidents
          .length,
        0,
      );
    },
  );
  await t.test(
    "event pagination replays ordered history once with no duplicates",
    async () => {
      const all = (await store.events(incident.id, { limit: 100 })).events;
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await store.events(
          incident.id,
          parseList({ limit: "2", ...(cursor ? { cursor } : {}) }, incident.id),
        );
        ids.push(...page.events.map((event) => event.id));
        cursor = page.next_cursor;
      } while (cursor);
      assert.deepEqual(
        ids,
        all.map((event) => event.id),
      );
      assert.equal(new Set(ids).size, ids.length);
    },
  );
  await t.test(
    "database status, severity, resolution and foreign-key constraints reject invalid writes",
    async () => {
      for (const statement of [
        "UPDATE sentinel_api.incidents SET status='INVALID' WHERE id=$1",
        "UPDATE sentinel_api.incidents SET severity='INVALID' WHERE id=$1",
        "UPDATE sentinel_api.incidents SET resolved_at=NULL WHERE id=$1",
        "UPDATE sentinel_api.incidents SET resolved_at=started_at - interval '1 second' WHERE id=$1",
        "UPDATE sentinel_api.incidents SET service_id='ffffffff-ffff-4fff-8fff-ffffffffffff' WHERE id=$1",
      ])
        await assert.rejects(pool.query(statement, [incident.id]));
      assert.equal((await store.get(incident.id)).status, "CLOSED");
    },
  );
  await t.test(
    "real incident HTTP create/read/transition/filter/event/error contract",
    async () => {
      const server = createApp(
        postgresRegistry(pool),
        () => {},
        store,
        domainAuth,
      ).listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api/v1/incidents`;
      const send = (method: string, body: unknown) => ({
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      try {
        const response = await fetch(base, send("POST", input));
        assert.equal(response.status, 201);
        const created = await response.json();
        assert.equal((await fetch(`${base}/${created.id}`)).status, 200);
        assert.equal(
          (
            await fetch(
              `${base}/${created.id}`,
              send("PATCH", { status: "CLOSED" }),
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await fetch(
              `${base}/${created.id}`,
              send("PATCH", { status: "INVESTIGATING" }),
            )
          ).status,
          200,
        );
        const filtered = await (
          await fetch(base + "?status=INVESTIGATING")
        ).json();
        assert.deepEqual(
          filtered.incidents.map((row: Incident) => row.id),
          [created.id],
        );
        assert.equal(
          (await (await fetch(`${base}/${created.id}/events`)).json()).events
            .length,
          2,
        );
        const missing = await fetch(
          base,
          send("POST", { ...input, service_id: randomUUID() }),
        );
        assert.equal(missing.status, 404);
        assert.equal((await missing.json()).error.code, "SERVICE_NOT_FOUND");
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    },
  );
}
