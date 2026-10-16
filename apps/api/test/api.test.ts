import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import {
  listServices,
  RegistryUnavailable,
  type Registry,
} from "../src/services.js";

const local = {
  SENTINEL_DATABASE_URL:
    "postgresql://demo:fake-password@127.0.0.1:55434/sentinel_api",
  SENTINEL_DATABASE_TLS: "disable",
};
const row = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "checkout-service",
  owner: "demo",
  environment: "development",
  created_at: new Date("2026-01-01T00:00:00Z"),
};

test("configuration accepts explicit local development and defaults remote TLS to verified", () => {
  assert.equal(readConfig(local).databaseTls, false);
  const config = readConfig({
    SENTINEL_DATABASE_URL: "postgresql://demo:fake@db.example.com/sentinel",
  });
  assert.equal(config.databaseTls, true);
  const pool = createPool(config);
  assert.deepEqual(pool.options.ssl, { rejectUnauthorized: true });
  assert.equal(pool.options.max, 5);
  void pool.end();
});
for (const [label, env] of [
  ["missing URL", {}],
  [
    "remote plaintext",
    {
      ...local,
      SENTINEL_DATABASE_URL: "postgresql://u:fake@db.example.com/app",
    },
  ],
  [
    "URL TLS override",
    {
      ...local,
      SENTINEL_DATABASE_URL: local.SENTINEL_DATABASE_URL + "?sslmode=no-verify",
    },
  ],
  [
    "bad protocol",
    { ...local, SENTINEL_DATABASE_URL: "https://u:fake@localhost/app" },
  ],
  [
    "missing password",
    { ...local, SENTINEL_DATABASE_URL: "postgresql://u@localhost/app" },
  ],
  ["invalid port", { ...local, SENTINEL_API_PORT: "0" }],
  ["invalid TLS", { ...local, SENTINEL_DATABASE_TLS: "no-verify" }],
] as const) {
  test(`configuration rejects ${label} without leaking values`, () => {
    assert.throws(
      () => readConfig(env),
      (error) => error instanceof Error && !error.message.includes("fake"),
    );
  });
}

test("response validation allowlists fields and emits UTC timestamps", async () => {
  assert.deepEqual(
    await listServices({
      ready: async () => true,
      list: async () => [{ ...row, password: "never-expose" }],
    }),
    [{ ...row, created_at: "2026-01-01T00:00:00.000Z" }],
  );
});
test("response validation rejects corrupt rows and oversized registries", async () => {
  for (const rows of [
    [{ ...row, id: "bad" }],
    [{ ...row, created_at: "yesterday" }],
    [{ ...row, environment: "invalid" }],
    Array(101).fill(row),
  ]) {
    await assert.rejects(
      listServices({ ready: async () => true, list: async () => rows }),
    );
  }
});

test("HTTP contracts, correlation, safe errors and safe logs", async (t) => {
  let mode = "healthy";
  const registry: Registry = {
    ready: async () => {
      if (mode === "unavailable") throw new Error("secret-credentials");
      return mode !== "missing";
    },
    list: async () => {
      if (mode === "unavailable")
        throw new RegistryUnavailable("secret-credentials");
      return mode === "invalid" ? [{ ...row, id: "bad" }] : [row];
    },
  };
  const logs: Record<string, unknown>[] = [];
  const server = createApp(registry, (record) => logs.push(record)).listen(
    0,
    "127.0.0.1",
  );
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, options?: RequestInit) =>
    fetch(base + path, { ...options, signal: AbortSignal.timeout(5000) });
  try {
    await t.test("health, readiness and real controller response", async () => {
      assert.equal((await request("/health")).status, 200);
      assert.equal((await request("/ready")).status, 200);
      const response = await request("/api/v1/services", {
        headers: { "x-request-id": row.id },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-request-id"), row.id);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        services: [{ ...row, created_at: row.created_at.toISOString() }],
      });
    });
    await t.test(
      "unknown route and unsupported method return controlled 404",
      async () => {
        for (const [path, method] of [
          ["/secret-credentials?token=secret-credentials", "GET"],
          ["/api/v1/services", "POST"],
        ]) {
          const response = await request(path, {
            method,
            headers: {
              authorization: "secret-credentials",
              "x-request-id": "secret-credentials",
            },
          });
          assert.equal(response.status, 404);
          const body = await response.json();
          assert.equal(body.error.code, "NOT_FOUND");
          assert.equal(body.request_id, response.headers.get("x-request-id"));
        }
      },
    );
    await t.test("missing schema is not ready", async () => {
      mode = "missing";
      assert.equal((await request("/ready")).status, 503);
    });
    await t.test(
      "database outage keeps health alive and sanitizes dependency failures",
      async () => {
        mode = "unavailable";
        assert.equal((await request("/health")).status, 200);
        assert.equal((await request("/ready")).status, 503);
        const response = await request("/api/v1/services");
        assert.equal(response.status, 503);
        assert.equal(
          (await response.json()).error.code,
          "DATABASE_UNAVAILABLE",
        );
      },
    );
    await t.test("corrupt database output fails closed", async () => {
      mode = "invalid";
      const response = await request("/api/v1/services");
      assert.equal(response.status, 500);
      assert.equal(
        (await response.json()).error.code,
        "INVALID_SERVICE_RESPONSE",
      );
    });
    assert.ok(logs.length > 0);
    assert.ok(!JSON.stringify(logs).includes("secret-credentials"));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});
