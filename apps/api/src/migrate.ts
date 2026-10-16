import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { readConfig } from "./config.js";
import { createPool } from "./db.js";

export const migrationDirectory = fileURLToPath(
  new URL("../../database/migrations/", import.meta.url),
);
export async function migrate(
  pool: Pool,
  directory = migrationDirectory,
): Promise<string[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(71623001)");
    await client.query("CREATE SCHEMA IF NOT EXISTS sentinel_api");
    await client.query(
      "CREATE TABLE IF NOT EXISTS sentinel_api.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const known = new Map(
      (
        await client.query(
          "SELECT name, checksum FROM sentinel_api.schema_migrations",
        )
      ).rows.map((row) => [row.name, row.checksum]),
    );
    const names = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    if ([...known.keys()].some((name) => !names.includes(name)))
      throw new Error("Applied migration missing from source");
    const applied: string[] = [];
    for (const name of names) {
      const source = (await readFile(resolve(directory, name), "utf8")).replace(
        /\r\n/g,
        "\n",
      );
      const checksum = createHash("sha256").update(source).digest("hex");
      if (known.has(name)) {
        if (known.get(name) !== checksum)
          throw new Error("Applied migration checksum mismatch");
        continue;
      }
      await client.query(source);
      await client.query(
        "INSERT INTO sentinel_api.schema_migrations (name, checksum) VALUES ($1, $2)",
        [name, checksum],
      );
      applied.push(name);
    }
    await client.query("COMMIT");
    return applied;
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
    pool = createPool(readConfig());
    const names = await migrate(pool);
    console.log(
      `API migrations applied: ${names.join(", ") || "none (already current)"}`,
    );
  } catch {
    console.error(
      "API migration failed; check configuration, database and migration history (values omitted)",
    );
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
