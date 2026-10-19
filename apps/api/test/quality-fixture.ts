/** P10.2 only: isolated alert receiver and stdin-driven report persistence. */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { createPool } from "../src/db.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { seedDemoServices } from "../src/seed.js";
import { createUser, postgresUsers } from "../src/auth-store.js";
import { createAuth, readAuthSecret } from "../src/auth.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { postgresInvestigations } from "../src/investigations.js";
import { postgresRegistry } from "../src/services.js";
import { postgresAlerts, readWebhookSecret } from "../src/alert-ingestion.js";
import { createApp } from "../src/app.js";

const config = readConfig();
const target = new URL(config.databaseUrl);
const directory = resolve(process.env.SENTINEL_QUALITY_DIRECTORY ?? "");
if (
  target.hostname !== "127.0.0.1" ||
  !/^\/sentinel_p10_quality_[a-f0-9]{12}$/.test(target.pathname) ||
  directory !== resolve(".artifacts", target.pathname.slice(1))
)
  throw new Error("Owned disposable P10 database and directory required");
const pool = createPool(config);
await migrate(pool);
await seedDemoServices(pool);
const password = process.env.SENTINEL_QUALITY_PASSWORD;
if (!password) throw new Error("Generated test password required");
await createUser(pool, "quality@example.test", password, "OPERATOR");
const store = postgresInvestigations(pool);
const server = createApp(
  postgresRegistry(pool),
  undefined,
  postgresIncidents(pool),
  createAuth(postgresUsers(pool), readAuthSecret()),
  store,
  postgresAlerts(pool, readWebhookSecret()!),
).listen(config.port, "127.0.0.1");
server.requestTimeout = 10000;
server.headersTimeout = 5000;
await writeFile(resolve(directory, "ready"), "ready");

// No HTTP test bypass: only this owned child's private stdin can finish reports.
for await (const line of createInterface({ input: process.stdin })) {
  let id = randomUUID();
  try {
    if (Buffer.byteLength(line) > 262144)
      throw new Error("Oversized fixture input");
    const input = JSON.parse(line);
    if (!/^[a-f0-9-]{36}$/.test(input.investigation_id))
      throw new Error("Invalid investigation id");
    id = input.investigation_id;
    const claim = await store.claim(id, 30);
    if (!claim) throw new Error("Claim unavailable");
    const collection = input.collection;
    if (
      !(await store.finish(
        id,
        claim.token,
        true,
        collection.evidence,
        undefined,
        collection.analysis,
      ))
    )
      throw new Error("Completion rejected");
    await writeFile(resolve(directory, `${id}.json`), '{"status":"SAVED"}');
  } catch {
    await writeFile(resolve(directory, `${id}.json`), '{"status":"FAILED"}');
  }
}
server.close();
await pool.end();
