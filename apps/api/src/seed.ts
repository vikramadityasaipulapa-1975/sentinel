import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { createPool } from "./db.js";
import { readConfig } from "./config.js";

export async function seedDemoServices(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [id, name] of [
      ["11111111-1111-4111-8111-111111111111", "checkout-service"],
      ["22222222-2222-4222-8222-222222222222", "payment-service"],
    ]) {
      await client.query(
        "INSERT INTO sentinel_api.services (id, name, owner, environment) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING",
        [id, name, "sentinel-demo", "development"],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let pool: Pool | undefined;
  try {
    if (
      process.env.SENTINEL_DATABASE_TLS !== "disable" ||
      !["localhost", "127.0.0.1"].includes(
        new URL(process.env.SENTINEL_DATABASE_URL ?? "").hostname,
      )
    ) {
      throw new Error(
        "Demo seed is restricted to explicit local development databases",
      );
    }
    pool = createPool(readConfig());
    await seedDemoServices(pool);
    console.log("Demo services seeded; existing names preserved");
  } catch {
    console.error(
      "Demo seed failed; use a migrated local database (values omitted)",
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
