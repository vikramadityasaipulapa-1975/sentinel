import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import type { TestContext } from "node:test";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import { AuthError, can, createAuth } from "../src/auth.js";
import { createUser, manageUser, postgresUsers } from "../src/auth-store.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresRegistry } from "../src/services.js";

export async function authDatabaseChecks(t: TestContext, pool: Pool) {
  const password = randomBytes(24).toString("hex");
  const secret = randomBytes(32);
  const users = postgresUsers(pool);
  const auth = createAuth(users, secret);
  await t.test(
    "explicit users have hashed passwords, normalized unique emails and no default accounts",
    async () => {
      assert.equal(
        (await pool.query("SELECT count(*)::int AS n FROM sentinel_api.users"))
          .rows[0].n,
        0,
      );
      for (const role of ["VIEWER", "OPERATOR", "ADMIN"] as const)
        await createUser(
          pool,
          role.toLowerCase() + "@example.test",
          password,
          role,
        );
      const user = await users.byEmail("viewer@example.test");
      assert.ok(user);
      assert.notEqual(user.password_hash, password);
      assert.ok(user.password_hash.startsWith("scrypt$131072$8$1$"));
      await assert.rejects(
        createUser(pool, "VIEWER@EXAMPLE.TEST", password, "VIEWER"),
      );
    },
  );
  await t.test(
    "PostgreSQL login limits are atomic, shared across stores, bounded and expire",
    async () => {
      const key = "a".repeat(64);
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          users.consumeLogin([{ key, limit: 3 }]),
        ),
      );
      assert.equal(results.filter(Boolean).length, 3);
      assert.equal(
        await postgresUsers(pool).consumeLogin([{ key, limit: 3 }]),
        false,
      );
      await pool.query(
        "UPDATE sentinel_api.login_limits SET window_start=statement_timestamp()-interval '16 minutes' WHERE key=$1",
        [key],
      );
      assert.equal(await users.consumeLogin([{ key, limit: 3 }]), true);
      await pool.query(
        "UPDATE sentinel_api.login_limits SET window_start=statement_timestamp()-interval '2 days' WHERE key=$1",
        [key],
      );
      await users.consumeLogin([{ key: "b".repeat(64), limit: 3 }]);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM sentinel_api.login_limits WHERE key=$1",
            [key],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  const server = createApp(
    postgresRegistry(pool),
    () => {},
    postgresIncidents(pool),
    auth,
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (
    path: string,
    token?: string,
    method = "GET",
    body?: unknown,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        ...(token ? { authorization: "Bearer " + token } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  const login = async (email: string, pass = password) => {
    const response = await request("/api/v1/auth/login", undefined, "POST", {
      email,
      password: pass,
    });
    assert.equal(response.status, 200);
    return (await response.json()).access_token as string;
  };
  try {
    await t.test(
      "real login distinguishes no accounts and returns safe profiles",
      async () => {
        const responses = [];
        for (const email of ["viewer@example.test", "unknown@example.test"]) {
          const response = await request(
            "/api/v1/auth/login",
            undefined,
            "POST",
            { email, password: "wrong password" },
          );
          assert.equal(response.status, 401);
          responses.push((await response.json()).error);
        }
        assert.deepEqual(responses[0], responses[1]);
        assert.equal((await request("/api/v1/services")).status, 401);
      },
    );
    await t.test(
      "viewer reads but cannot write; operator can create and transition incidents",
      async () => {
        const viewer = await login("viewer@example.test");
        const operator = await login("operator@example.test");
        assert.equal((await request("/api/v1/services", viewer)).status, 200);
        const input = {
          service_id: "11111111-1111-4111-8111-111111111111",
          title: "DEMO: authenticated integration",
          severity: "HIGH",
        };
        assert.equal(
          (await request("/api/v1/incidents", viewer, "POST", input)).status,
          403,
        );
        const created = await request(
          "/api/v1/incidents",
          operator,
          "POST",
          input,
        );
        assert.equal(created.status, 201);
        const incident = await created.json();
        assert.equal(
          (
            await request(`/api/v1/incidents/${incident.id}`, viewer, "PATCH", {
              status: "INVESTIGATING",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              `/api/v1/incidents/${incident.id}`,
              operator,
              "PATCH",
              { status: "INVESTIGATING" },
            )
          ).status,
          200,
        );
        assert.equal(
          (await request(`/api/v1/incidents/${incident.id}/events`, viewer))
            .status,
          200,
        );
        const profile = (
          await (await request("/api/v1/auth/me", viewer)).json()
        ).user;
        assert.equal(profile.role, "VIEWER");
        assert.equal("password_hash" in profile, false);
        assert.equal("token_version" in profile, false);
        assert.equal(can(profile.role, "APPROVE_ACTION"), false);
      },
    );
    await t.test(
      "role changes immediately affect existing tokens and password reset invalidates them",
      async () => {
        const token = await login("operator@example.test");
        await manageUser(pool, "role", "operator@example.test", "VIEWER");
        assert.equal(
          (await (await request("/api/v1/auth/me", token)).json()).user.role,
          "VIEWER",
        );
        assert.equal(
          (await request("/api/v1/incidents", token, "POST", {})).status,
          403,
        );
        const newPassword = randomBytes(24).toString("hex");
        await manageUser(
          pool,
          "password",
          "operator@example.test",
          undefined,
          newPassword,
        );
        assert.equal((await request("/api/v1/auth/me", token)).status, 401);
        assert.equal(
          (
            await request("/api/v1/auth/login", undefined, "POST", {
              email: "operator@example.test",
              password,
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request(
              "/api/v1/auth/me",
              await login("operator@example.test", newPassword),
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "disable/enable rejects login and permanently invalidates earlier tokens",
      async () => {
        const token = await login("admin@example.test");
        await manageUser(pool, "disable", "admin@example.test");
        assert.equal((await request("/api/v1/auth/me", token)).status, 401);
        assert.equal(
          (
            await request("/api/v1/auth/login", undefined, "POST", {
              email: "admin@example.test",
              password,
            })
          ).status,
          401,
        );
        await manageUser(pool, "enable", "admin@example.test");
        assert.equal((await request("/api/v1/auth/me", token)).status, 401);
        assert.equal(
          can(
            (
              await auth.authenticate(
                "Bearer " + (await login("admin@example.test")),
              )
            ).role,
            "APPROVE_ACTION",
          ),
          true,
        );
      },
    );
    await t.test(
      "account throttling is enforced before password work",
      async () => {
        const email = "limited@example.test";
        const { createHmac } = await import("node:crypto");
        const key = createHmac("sha256", secret)
          .update("login-limit:email:" + email)
          .digest("hex");
        for (let i = 0; i < 10; i++)
          await users.consumeLogin([{ key, limit: 10 }]);
        await assert.rejects(
          auth.login(email, password, "test-source"),
          (error) => error instanceof AuthError && error.status === 429,
        );
        const stored = (
          await pool.query("SELECT key FROM sentinel_api.login_limits")
        ).rows;
        assert.ok(stored.every((row) => /^[0-9a-f]{64}$/.test(row.key)));
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
}
