import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { before, test } from "node:test";
import { SignJWT } from "jose";
import { createApp } from "../src/app.js";
import {
  AuthError,
  can,
  createAuth,
  normalizeEmail,
  parseLogin,
  readAuthSecret,
  requirePermission,
  type User,
  type UserStore,
} from "../src/auth.js";
import {
  hashPassword,
  PasswordBusy,
  verifyPassword,
} from "../src/passwords.js";

const secret = Buffer.alloc(32, 19);
const password = "test-only password with spaces";
let user: User;
before(async () => {
  user = {
    id: randomUUID(),
    email: "viewer@example.test",
    role: "VIEWER",
    enabled: true,
    token_version: 0,
    password_hash: await hashPassword(password),
  };
});
const store = (): UserStore => ({
  ready: async () => true,
  byId: async (id) => (id === user.id ? { ...user } : null),
  byEmail: async (email) => (email === user.email ? { ...user } : null),
  consumeLogin: async () => true,
});
const minted = (
  overrides: Record<string, unknown> = {},
  key = secret,
  alg = "HS256",
  typ = "JWT",
) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: user.id,
    ver: 0,
    iss: "sentinel",
    aud: "sentinel-api",
    iat: now,
    exp: now + 900,
    jti: randomUUID(),
    ...overrides,
  })
    .setProtectedHeader({ alg, typ })
    .sign(key);
};

test("password hashes are salted, bounded, one-way and verified with exact input", async () => {
  const second = await hashPassword(password);
  assert.notEqual(second, user.password_hash);
  assert.ok(!second.includes(password));
  assert.equal(await verifyPassword(password, second), true);
  assert.equal(await verifyPassword(password + "!", second), false);
  assert.equal(
    await verifyPassword(password, "scrypt$999999999$8$1$bad$bad"),
    false,
  );
  await assert.rejects(hashPassword("short"));
  await assert.rejects(hashPassword("x".repeat(129)));
  assert.equal(await verifyPassword("x".repeat(129), second), false);
});
test("password work has a concurrency ceiling instead of an unbounded queue", async () => {
  const first = hashPassword(password);
  const second = hashPassword(password);
  await assert.rejects(hashPassword(password), PasswordBusy);
  await Promise.all([first, second]);
});
test("login and key configuration reject malformed, excessive and extra fields", () => {
  assert.equal(normalizeEmail(" Viewer@Example.Test "), "viewer@example.test");
  assert.equal(
    readAuthSecret({ SENTINEL_JWT_SECRET: "ab".repeat(32) }).byteLength,
    32,
  );
  for (const value of [undefined, "short", "g".repeat(64)])
    assert.throws(() => readAuthSecret({ SENTINEL_JWT_SECRET: value }));
  for (const value of [
    null,
    [],
    {},
    { email: "bad", password },
    { email: user.email, password, role: "ADMIN" },
    { email: user.email, password: "" },
    { email: user.email, password: "x".repeat(129) },
  ])
    assert.throws(() => parseLogin(value), AuthError);
});
test("JWT verifies allowed claims, rejects tampering and never trusts an embedded role", async () => {
  const auth = createAuth(store(), secret);
  const token = await minted({ role: "ADMIN" });
  assert.equal((await auth.authenticate(`Bearer ${token}`)).role, "VIEWER");
  const now = Math.floor(Date.now() / 1000);
  const bad = [
    await minted({}, Buffer.alloc(32, 20)),
    await minted({ exp: now - 100, iat: now - 200 }),
    await minted({ aud: "wrong" }),
    await minted({ iss: "wrong" }),
    await minted({ sub: randomUUID() }),
    await minted({ ver: 1 }),
    await minted({ iat: now + 100, exp: now + 1000 }),
    await minted({ exp: now + 901 }),
    await minted({ exp: undefined }),
    await minted({ jti: "bad" }),
    await minted({}, secret, "HS384"),
    await minted({}, secret, "HS256", "wrong"),
  ];
  for (const header of [
    undefined,
    "",
    "Bearer nope",
    "Basic nope",
    "Bearer " + token + "x",
    "Bearer " + "x".repeat(5000),
    ...bad.map((value) => "Bearer " + value),
  ])
    await assert.rejects(
      auth.authenticate(header),
      (error) => error instanceof AuthError && error.status === 401,
    );
});
test("permission matrix denies viewer writes and reserves approvals for ADMIN", () => {
  assert.equal(can("VIEWER", "READ"), true);
  assert.equal(can("VIEWER", "WRITE_INCIDENT"), false);
  assert.equal(can("VIEWER", "APPROVE_ACTION"), false);
  assert.equal(can("OPERATOR", "WRITE_INCIDENT"), true);
  assert.equal(can("OPERATOR", "APPROVE_ACTION"), false);
  assert.equal(can("ADMIN", "APPROVE_ACTION"), true);
});
test("unknown email, wrong password and disabled account share one login error; reset race is rejected", async () => {
  const auth = createAuth(store(), secret);
  for (const email of [user.email, "unknown@example.test"])
    await assert.rejects(
      auth.login(email, "wrong password", "127.0.0.1"),
      (error) =>
        error instanceof AuthError &&
        error.status === 401 &&
        error.code === "UNAUTHORIZED",
    );
  await assert.rejects(
    createAuth(
      { ...store(), byId: async () => ({ ...user, token_version: 1 }) },
      secret,
    ).login(user.email, password, "127.0.0.1"),
    (error) => error instanceof AuthError && error.status === 401,
  );
  await assert.rejects(
    createAuth(
      { ...store(), byEmail: async () => ({ ...user, enabled: false }) },
      secret,
    ).login(user.email, password, "127.0.0.1"),
    (error) => error instanceof AuthError && error.status === 401,
  );
  await assert.rejects(
    createAuth({ ...store(), consumeLogin: async () => false }, secret).login(
      user.email,
      password,
      "127.0.0.1",
    ),
    (error) => error instanceof AuthError && error.status === 429,
  );
});
test("HTTP denies absent auth, verifies real tokens, enforces roles and exposes a safe login page", async (t) => {
  let current = { ...user };
  const auth = createAuth(
    { ...store(), byId: async (id) => (id === current.id ? current : null) },
    secret,
  );
  const logs: Record<string, unknown>[] = [];
  const app = createApp(
    { ready: async () => true, list: async () => [] },
    (record) => logs.push(record),
    undefined,
    auth,
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    await t.test(
      "public page and health; protected resources reject missing or query tokens",
      async () => {
        assert.equal((await fetch(base + "/health")).status, 200);
        const page = await fetch(base + "/auth-test");
        assert.equal(page.status, 200);
        assert.ok((await page.text()).includes('type="password"'));
        assert.ok(
          page.headers
            .get("content-security-policy")
            ?.includes("frame-ancestors 'none'"),
        );
        for (const path of [
          "/api/v1/auth/me",
          "/api/v1/services",
          "/api/v1/incidents?access_token=secret-marker",
        ])
          assert.equal((await fetch(base + path)).status, 401);
      },
    );
    await t.test(
      "successful login, safe profile, live disable and role change",
      async () => {
        const response = await fetch(base + "/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: user.email, password }),
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.expires_in, 900);
        assert.equal("password_hash" in body.user, false);
        const headers = { authorization: "Bearer " + body.access_token };
        assert.equal(
          (await fetch(base + "/api/v1/services", { headers })).status,
          200,
        );
        current = { ...current, role: "OPERATOR" };
        assert.equal(
          (await (await fetch(base + "/api/v1/auth/me", { headers })).json())
            .user.role,
          "OPERATOR",
        );
        current = { ...current, enabled: false };
        assert.equal(
          (await fetch(base + "/api/v1/services", { headers })).status,
          401,
        );
        assert.ok(!JSON.stringify(logs).includes(body.access_token));
      },
    );
    assert.ok(!JSON.stringify(logs).includes(password));
    assert.ok(!JSON.stringify(logs).includes("secret-marker"));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});
test("reserved approval middleware rejects a viewer on the backend", () => {
  const guard = requirePermission("APPROVE_ACTION");
  assert.throws(
    () =>
      guard(
        {} as never,
        { locals: { user: { role: "VIEWER" } } } as never,
        () => {
          throw new Error("must not pass");
        },
      ),
    (error) => error instanceof AuthError && error.status === 403,
  );
});
