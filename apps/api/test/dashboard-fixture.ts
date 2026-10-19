/** Test-only isolated backend. No Docker executor or production queue is used. */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createPool } from "../src/db.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { seedDemoServices } from "../src/seed.js";
import { createUser, postgresUsers } from "../src/auth-store.js";
import { createAuth, readAuthSecret } from "../src/auth.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresInvestigations } from "../src/investigations.js";
import { postgresRemediations } from "../src/remediation-repository.js";
import { postgresRegistry } from "../src/services.js";
import { collectInvestigation, evidenceConfig } from "../src/evidence.js";
import { createApp } from "../src/app.js";
const config = readConfig();
const target = new URL(config.databaseUrl);
if (
  target.hostname !== "127.0.0.1" ||
  !/^\/sentinel_p9_verify_[a-f0-9]{12}$/.test(target.pathname)
)
  throw new Error("Disposable P9 database required");
const pool = createPool(config);
await migrate(pool);
await seedDemoServices(pool);
const password = process.env.SENTINEL_WEB_TEST_PASSWORD!,
  output = process.env.SENTINEL_WEB_TEST_FIXTURE!;
if (!password || !output)
  throw new Error("Generated test configuration required");
const users: Record<string, string> = {};
for (const role of ["VIEWER", "OPERATOR", "ADMIN"] as const)
  users[role] = await createUser(
    pool,
    `${role.toLowerCase()}@p9.example.test`,
    password,
    role,
  );
const incidents = postgresIncidents(pool),
  investigations = postgresInvestigations(pool),
  remediations = postgresRemediations(pool);
const item = await incidents.create({
  service_id: "22222222-2222-4222-8222-222222222222",
  title: "P9 browser: payment evidence",
  severity: "HIGH",
});
const collector = evidenceConfig();
if (!collector) throw new Error("Live test collector required");
async function finish(id: string) {
  const claim = await investigations.claim(id, 30);
  if (!claim) return;
  const end = new Date(),
    start = new Date(end.getTime() - 600000);
  const collected = await collectInvestigation(
    collector!,
    "payment-service",
    start.toISOString(),
    end.toISOString(),
  );
  if (
    !(await investigations.finish(
      id,
      claim.token,
      true,
      collected.evidence,
      undefined,
      collected.analysis,
      collected.knowledge,
    ))
  )
    throw new Error("Test completion lost lease");
}
const first = await investigations.enqueue(
  item.id,
  users.OPERATOR,
  randomUUID(),
);
await finish(first.id);
const syntheticBinding = {
  project: "sentinel-remediation-sandbox",
  container_id: "a".repeat(64),
  current_image: "sha256:" + "b".repeat(64),
  current_version: "payment-v3-error",
  target_image: "sha256:" + "c".repeat(64),
  target_version: "payment-v1",
};
await pool.query(
  "INSERT INTO sentinel_api.sandbox_binding(project,binding_json) VALUES($1,$2)",
  [syntheticBinding.project, JSON.stringify(syntheticBinding)],
);
const proposal = await remediations.propose(
  {
    action: "ROLLBACK_SANDBOX_PAYMENT",
    incident_id: item.id,
    idempotency_key: randomUUID(),
  },
  users.ADMIN,
  { version: 0, expires_at: Math.floor(Date.now() / 1000) + 900 },
);
// Extra records exercise real server pagination without touching learner data.
for (let i = 0; i < 21; i++)
  await incidents.create({
    service_id: "11111111-1111-4111-8111-111111111111",
    title: `P9 browser: pagination ${i + 1}`,
    severity: "LOW",
  });
const server = createApp(
  postgresRegistry(pool),
  () => {},
  incidents,
  createAuth(postgresUsers(pool), readAuthSecret()),
  investigations,
  undefined,
  remediations,
).listen(config.port, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
await writeFile(
  output,
  JSON.stringify({ incident: item.id, run: first.id, action: proposal.id }),
  "utf8",
);
let active = false,
  stopping = false;
const timer = setInterval(() => {
  if (active || stopping) return;
  active = true;
  void (async () => {
    try {
      const jobs = await pool.query(
        "SELECT id FROM sentinel_api.investigations WHERE status='QUEUED' ORDER BY created_at LIMIT 1",
      );
      if (jobs.rows[0]) await finish(jobs.rows[0].id);
    } catch {
      console.error("Test-only investigation harness failed; details omitted");
      process.exitCode = 1;
    } finally {
      active = false;
    }
  })();
}, 500);
async function close() {
  stopping = true;
  clearInterval(timer);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
  process.exit();
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
