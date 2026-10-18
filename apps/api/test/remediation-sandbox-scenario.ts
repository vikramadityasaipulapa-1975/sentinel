import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { createPool } from "../src/db.js";
import { readConfig } from "../src/config.js";
import { createAuth } from "../src/auth.js";
import { createUser, postgresUsers } from "../src/auth-store.js";
import { postgresRegistry } from "../src/services.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresRemediations } from "../src/remediation-repository.js";
import { ACTION, SANDBOX } from "../src/remediation-policy.js";

const dsn = process.env.TEST_P8_DATABASE_URL!;
const url = new URL(dsn);
assert.equal(url.hostname, "127.0.0.1");
assert.match(url.pathname, /^\/sentinel_p8_verify_[a-f0-9]+$/);
const pool = createPool(
  readConfig({ SENTINEL_DATABASE_URL: dsn, SENTINEL_DATABASE_TLS: "disable" }),
);
const store = postgresRemediations(pool);
const password = randomBytes(24).toString("hex");
let server: ReturnType<ReturnType<typeof createApp>["listen"]> | undefined;
try {
  const actors: Record<string, string> = {};
  for (const role of ["VIEWER", "OPERATOR", "ADMIN"] as const)
    actors[role] = await createUser(
      pool,
      `${role.toLowerCase()}@p8.example.test`,
      password,
      role,
    );
  const config = JSON.parse(
    readFileSync(resolve(".artifacts/p8-sandbox.json"), "utf8"),
  );
  await pool.query(
    "INSERT INTO sentinel_api.sandbox_binding(project,binding_json) VALUES ($1,$2)",
    [SANDBOX, config.binding],
  );
  server = createApp(
    postgresRegistry(pool),
    () => {},
    postgresIncidents(pool),
    createAuth(postgresUsers(pool), randomBytes(32)),
    undefined,
    undefined,
    store,
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
  ) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  const tokens: Record<string, string> = {};
  for (const role of ["VIEWER", "OPERATOR", "ADMIN"]) {
    const res = await request("/api/v1/auth/login", "POST", {
      email: `${role.toLowerCase()}@p8.example.test`,
      password,
    });
    assert.equal(res.status, 200);
    tokens[role] = res.body.access_token;
  }
  const created = await request(
    "/api/v1/incidents",
    "POST",
    {
      service_id: "22222222-2222-4222-8222-222222222222",
      title: "DEMO: isolated approved rollback",
      severity: "HIGH",
    },
    tokens.OPERATOR,
  );
  assert.equal(created.status, 201);
  const proposal = {
    action: ACTION,
    incident_id: created.body.id,
    idempotency_key: randomUUID(),
  };
  assert.equal(
    (await request("/api/v1/remediations", "POST", proposal)).status,
    401,
  );
  assert.equal(
    (await request("/api/v1/remediations", "POST", proposal, tokens.VIEWER))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/v1/remediations",
        "POST",
        { ...proposal, command: "rollback" },
        tokens.OPERATOR,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/v1/remediations/dry-run",
        "POST",
        proposal,
        tokens.OPERATOR,
      )
    ).body.execution_performed,
    false,
  );
  async function execute(id: string) {
    const py = process.env.TEST_P8_PYTHON!;
    const result = await promisify(execFile)(
      py,
      [
        "-c",
        "import os,sys;sys.path.insert(0,'scripts');from sandbox_executor import execute;import json;print(json.dumps(execute(os.environ['TEST_P8_DATABASE_URL'],sys.argv[1])))",
        id,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: "utf8",
        timeout: 90000,
      },
    );
    return JSON.parse(result.stdout);
  }
  const pending = await request(
    "/api/v1/remediations",
    "POST",
    proposal,
    tokens.OPERATOR,
  );
  assert.equal(pending.status, 201);
  const id = pending.body.id;
  assert.equal((await execute(id)).status, "NO_EXECUTION");
  assert.equal(
    (
      await request(
        `/api/v1/remediations/${id}/decision`,
        "POST",
        { decision: "APPROVE" },
        tokens.VIEWER,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/v1/remediations/${id}/decision`,
        "POST",
        { decision: "APPROVE" },
        tokens.OPERATOR,
      )
    ).status,
    403,
  );
  const approvals = await Promise.all([
    request(
      `/api/v1/remediations/${id}/decision`,
      "POST",
      { decision: "APPROVE" },
      tokens.ADMIN,
    ),
    request(
      `/api/v1/remediations/${id}/decision`,
      "POST",
      { decision: "APPROVE" },
      tokens.ADMIN,
    ),
  ]);
  assert.ok(approvals.every((row) => row.body.status === "APPROVED"));
  const result = await execute(id);
  assert.equal(result.status, "VERIFIED", JSON.stringify(result));
  assert.equal((await execute(id)).status, "NO_EXECUTION");
  const saved = await request(
    `/api/v1/remediations/${id}`,
    "GET",
    undefined,
    tokens.VIEWER,
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.status, "VERIFIED");
  assert.deepEqual(
    saved.body.events.map((row: { status: string }) => row.status),
    ["PENDING", "APPROVED", "EXECUTING", "VERIFIED"],
  );
  assert.equal(
    (await postgresIncidents(pool).get(created.body.id)).status,
    "OPEN",
  );
  console.log(
    JSON.stringify({
      status: "PASSED",
      kind: "real local sandbox rollback; synthetic payments",
      authorization: "real HTTP login/RBAC and PostgreSQL decisions",
      result,
      duplicate_execution: "NO_EXECUTION",
      incident_auto_resolved: false,
    }),
  );
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  await pool.end();
}
