import { investigationDatabaseChecks } from "./investigation-database-checks.js";
import { domainAuth } from "./auth-fixture.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { migrate, migrationDirectory } from "../src/migrate.js";
import { seedDemoServices } from "../src/seed.js";
import { listServices, postgresRegistry } from "../src/services.js";
import { incidentDatabaseChecks } from "./incident-database-checks.js";
import { postgresIncidents } from "../src/incident-repository.js";
import { authDatabaseChecks } from "./auth-database-checks.js";

test(
  "real PostgreSQL migration, constraints, API and failure boundaries",
  { skip: !process.env.TEST_API_DATABASE_URL },
  async (t) => {
    const url = new URL(process.env.TEST_API_DATABASE_URL!);
    assert.equal(
      url.pathname,
      "/sentinel_api_verify",
      "Only the dedicated verifier database may be tested",
    );
    assert.equal(url.hostname, "127.0.0.1");
    const pool = createPool(
      readConfig({
        SENTINEL_DATABASE_URL: url.href,
        SENTINEL_DATABASE_TLS: "disable",
      }),
    );
    const registry = postgresRegistry(pool);
    try {
      await t.test("fresh database is not schema-ready", async () =>
        assert.equal(await registry.ready(), false),
      );
      await t.test("migration applies once and replay is a no-op", async () => {
        // Exercise a real P3.1 -> P3.2 upgrade without resetting existing data.
        const oldDirectory = await mkdtemp(join(tmpdir(), "sentinel-api-v1-"));
        await writeFile(
          join(oldDirectory, "001_services.sql"),
          await readFile(join(migrationDirectory, "001_services.sql")),
        );
        assert.deepEqual(await migrate(pool, oldDirectory), [
          "001_services.sql",
        ]);
        await seedDemoServices(pool);
        assert.equal(await postgresIncidents(pool).ready(), false);
        assert.deepEqual(await migrate(pool), [
          "002_incidents.sql",
          "003_users.sql",
          "004_investigations.sql",
        ]);
        assert.deepEqual(await migrate(pool), []);
        assert.equal(await registry.ready(), true);
        assert.equal(await postgresIncidents(pool).ready(), true);
        assert.equal((await listServices(registry)).length, 2);
      });
      await t.test(
        "changed or missing applied migration is rejected",
        async () => {
          const directory = await mkdtemp(
            join(tmpdir(), "sentinel-api-migrations-"),
          );
          await assert.rejects(migrate(pool, directory), /missing/);
          await writeFile(
            join(directory, "003_users.sql"),
            await readFile(join(migrationDirectory, "003_users.sql")),
          );
          await writeFile(
            join(directory, "002_incidents.sql"),
            await readFile(join(migrationDirectory, "002_incidents.sql")),
          );
          await writeFile(
            join(directory, "004_investigations.sql"),
            await readFile(join(migrationDirectory, "004_investigations.sql")),
          );
          await writeFile(join(directory, "001_services.sql"), "SELECT 1;");
          await assert.rejects(migrate(pool, directory), /checksum/);
          await writeFile(
            join(directory, "001_services.sql"),
            await readFile(join(migrationDirectory, "001_services.sql")),
          );
          await writeFile(
            join(directory, "005_invalid.sql"),
            "CREATE TABLE sentinel_api.must_rollback (id integer); SELECT * FROM sentinel_api.does_not_exist;",
          );
          await assert.rejects(migrate(pool, directory));
          assert.equal(
            (
              await pool.query(
                "SELECT to_regclass('sentinel_api.must_rollback') AS table_name",
              )
            ).rows[0].table_name,
            null,
          );
          assert.equal(
            (
              await pool.query(
                "SELECT count(*)::int AS n FROM sentinel_api.schema_migrations",
              )
            ).rows[0].n,
            4,
          );
        },
      );
      await t.test(
        "explicit seed is replayable and database-backed",
        async () => {
          await seedDemoServices(pool);
          await seedDemoServices(pool);
          assert.deepEqual(
            (await listServices(registry)).map((row) => row.name),
            ["checkout-service", "payment-service"],
          );
        },
      );
      await t.test(
        "unique and check constraints reject invalid writes and rollback",
        async () => {
          for (const [name, environment] of [
            ["checkout-service", "development"],
            ["invalid name", "development"],
            ["third-service", "invalid"],
          ]) {
            const client = await pool.connect();
            try {
              await client.query("BEGIN");
              await assert.rejects(
                client.query(
                  "INSERT INTO sentinel_api.services (id, name, owner, environment) VALUES ($1, $2, $3, $4)",
                  [randomUUID(), name, "demo", environment],
                ),
              );
              await client.query("ROLLBACK");
            } finally {
              client.release();
            }
          }
          assert.equal((await listServices(registry)).length, 2);
        },
      );
      await t.test("database statement deadline cancels slow SQL", async () => {
        await assert.rejects(
          pool.query("SELECT pg_sleep(10)"),
          (error) =>
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "57014",
        );
      });
      await t.test(
        "HTTP services endpoint uses real PostgreSQL rows",
        async () => {
          const server = createApp(
            registry,
            () => {},
            undefined,
            domainAuth,
          ).listen(0, "127.0.0.1");
          await once(server, "listening");
          const address = server.address();
          assert.ok(address && typeof address !== "string");
          try {
            const response = await fetch(
              `http://127.0.0.1:${address.port}/api/v1/services`,
              { signal: AbortSignal.timeout(5000) },
            );
            assert.equal(response.status, 200);
            assert.deepEqual(
              (await response.json()).services,
              await listServices(registry),
            );
          } finally {
            await new Promise<void>((resolve, reject) => {
              server.close((error) => (error ? reject(error) : resolve()));
              server.closeAllConnections();
            });
          }
        },
      );
      await incidentDatabaseChecks(t, pool);
      await authDatabaseChecks(t, pool);
      await investigationDatabaseChecks(t, pool);
    } finally {
      await pool.end();
    }
  },
);
