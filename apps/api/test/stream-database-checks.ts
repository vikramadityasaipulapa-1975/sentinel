import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { SignJWT } from "jose";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { createUser, postgresUsers } from "../src/auth-store.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresInvestigations } from "../src/investigations.js";
import { postgresRegistry } from "../src/services.js";

export async function streamDatabaseChecks(t: TestContext, pool: Pool) {
  const secret = randomBytes(32);
  const user = await createUser(
    pool,
    "stream-reader@example.test",
    randomBytes(24).toString("hex"),
    "OPERATOR",
  );
  const auth = createAuth(postgresUsers(pool), secret);
  const incidents = postgresIncidents(pool);
  const incident = await incidents.create({
    service_id: "11111111-1111-4111-8111-111111111111",
    title: "DEMO: stream checks",
    severity: "HIGH",
  });
  const token = async (seconds = 60) =>
    new SignJWT({ ver: 0 })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user)
      .setIssuer("sentinel")
      .setAudience("sentinel-api")
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
      .setJti(randomUUID())
      .sign(secret);
  const server = createApp(
    postgresRegistry(pool),
    () => {},
    incidents,
    auth,
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/v1/incidents/${incident.id}/stream`;
  const bearer = await token();
  const open = (last?: string, access = bearer, target = url) =>
    fetch(target, {
      headers: {
        authorization: `Bearer ${access}`,
        ...(last ? { "last-event-id": last } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
  async function event(reader: ReadableStreamDefaultReader<Uint8Array>) {
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      buffer += new TextDecoder().decode(chunk.value);
      const match =
        /id: ([^\n]+)\nevent: incident_event\ndata: ([^\n]+)\n\n/.exec(buffer);
      if (match) return { cursor: match[1], data: JSON.parse(match[2]) };
    }
  }
  try {
    await t.test(
      "SSE delivers persisted history, live worker events and ordered reconnect replay",
      async () => {
        const first = await open();
        assert.equal(first.status, 200);
        assert.match(first.headers.get("content-type")!, /text\/event-stream/);
        const reader = first.body!.getReader();
        const initial = await event(reader);
        assert.equal(initial.data.type, "CREATED");
        const run = await postgresInvestigations(pool).enqueue(
          incident.id,
          user,
          randomUUID(),
        );
        const live = await event(reader);
        assert.equal(live.data.payload.investigation_id, run.id);
        assert.ok(BigInt(live.data.sequence) > BigInt(initial.data.sequence));
        await reader.cancel();
        await incidents.transition(incident.id, "INVESTIGATING");
        const replay = await open(live.cursor);
        const resumed = replay.body!.getReader();
        const next = await event(resumed);
        assert.equal(next.data.type, "STATUS_CHANGED");
        assert.ok(BigInt(next.data.sequence) > BigInt(live.data.sequence));
        await resumed.cancel();
      },
    );
    await t.test(
      "SSE rejects anonymous requests, wrong-scope cursors and query tokens",
      async () => {
        assert.equal((await fetch(url)).status, 401);
        assert.equal((await open("bad-cursor")).status, 400);
        assert.equal(
          (await open(undefined, bearer, url + "?token=forbidden")).status,
          400,
        );
        const other = Buffer.from(
          JSON.stringify({
            v: 1,
            position: "1",
            scope: `events|${randomUUID()}`,
          }),
        ).toString("base64url");
        assert.equal((await open(other)).status, 400);
      },
    );
    await t.test(
      "SSE bounds concurrent streams and closes at verified JWT expiry",
      async () => {
        const a = await open(),
          b = await open();
        assert.equal((await open()).status, 429);
        await a.body!.cancel();
        await b.body!.cancel();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const short = await open(undefined, await token(2));
        assert.equal(short.status, 200);
        const start = Date.now();
        await short.text();
        assert.ok(Date.now() - start < 4000);
        // A token inside general JWT clock tolerance is still too old for a stream.
        const expired = await token(1);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        assert.equal((await open(undefined, expired)).status, 401);
      },
    );
    await t.test(
      "SSE rechecks account revocation on an open connection",
      async () => {
        const response = await open();
        await pool.query(
          "UPDATE sentinel_api.users SET enabled = false WHERE id = $1",
          [user],
        );
        const text = await response.text();
        assert.match(text, /event: auth_expired/);
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
