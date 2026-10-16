import pg from "pg";
import type { Config } from "./config.js";

export function createPool(config: Config) {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseTls
      ? {
          rejectUnauthorized: true,
          ...(config.databaseCa ? { ca: config.databaseCa } : {}),
        }
      : false,
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
    query_timeout: 4000,
    options: "-c timezone=UTC -c lock_timeout=2000",
    application_name: "sentinel-api",
  });
  // Idle client failures must be handled; never log driver errors or credentials.
  pool.on("error", () =>
    console.error(
      JSON.stringify({
        event: "database_connection_error",
        service: "sentinel-api",
      }),
    ),
  );
  return pool;
}
