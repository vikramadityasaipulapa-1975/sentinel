import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { SignJWT } from "jose";
import { createApp } from "../src/app.js";
import { createAuth, type User } from "../src/auth.js";
import type { RemediationStore } from "../src/remediation-repository.js";

test("origin, malformed-input and authorization failures do not leak canaries or reach action storage", async () => {
  const marker = "security-canary-" + randomUUID();
  const secret = randomBytes(32);
  const user: User = {
    id: randomUUID(),
    email: "security@example.test",
    role: "VIEWER",
    enabled: true,
    token_version: 0,
    password_hash: "unused in this JWT-only fixture",
  };
  // A store double isolates HTTP policy. Real JWT verification remains active.
  const auth = createAuth(
    {
      ready: async () => true,
      byEmail: async () => null,
      byId: async () => ({ ...user }),
      consumeLogin: async () => true,
    },
    secret,
  );
  const token = await new SignJWT({ ver: 0 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer("sentinel")
    .setAudience("sentinel-api")
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(secret);
  const logs: Record<string, unknown>[] = [];
  let actionCalls = 0;
  const actions = new Proxy({} as RemediationStore, {
    get: () => () => {
      actionCalls++;
      throw new Error("Forbidden test-store call");
    },
  });
  let broken = false;
  const app = createApp(
    {
      ready: async () => true,
      list: async () => {
        if (broken) throw new Error(marker);
        return [];
      },
    },
    (record) => logs.push(record),
    undefined,
    auth,
    undefined,
    undefined,
    actions,
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const captured: string[] = [];
  async function check(path: string, status: number, init: RequestInit = {}) {
    const response = await fetch(base + path, {
      ...init,
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(
      response.headers.get("access-control-allow-credentials"),
      null,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    captured.push(await response.text(), JSON.stringify([...response.headers]));
  }
  const origin = { origin: "https://untrusted.example.test" };
  try {
    await check("/api/v1/services?access_token=" + marker, 401, {
      headers: {
        ...origin,
        authorization: "Bearer " + marker,
        "x-request-id": marker,
        cookie: "private=" + marker,
      },
    });
    await check("/api/v1/services", 401, {
      method: "OPTIONS",
      headers: {
        ...origin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    await check("/api/v1/auth/login", 400, {
      method: "POST",
      headers: { ...origin, "content-type": "application/json" },
      body: '{"password":"' + marker,
    });
    await check("/api/v1/auth/login", 413, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: marker + "x".repeat(9000) }),
    });
    const headers = {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      ...origin,
    };
    await check("/api/v1/services", 200, { headers });
    await check(`/api/v1/remediations/${randomUUID()}/decision`, 403, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "APPROVE", command: marker }),
    });
    user.role = "ADMIN";
    await check(`/api/v1/remediations/${randomUUID()}/decision`, 400, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "APPROVE", command: marker }),
    });
    broken = true;
    await check("/api/v1/services", 500, { headers });
    user.enabled = false;
    await check("/api/v1/services", 401, { headers });
    assert.equal(actionCalls, 0);
    const output = captured.join("\n") + JSON.stringify(logs);
    assert.ok(
      !output.includes(marker),
      "sensitive request/error canary must be omitted",
    );
    assert.ok(
      !output.includes(token),
      "verified bearer token must never be logged/reflected",
    );
    assert.ok(!output.includes(user.password_hash));
    assert.ok(logs.length >= 9);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
