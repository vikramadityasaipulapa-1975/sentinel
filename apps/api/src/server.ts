import { createApp } from "./app.js";
import { readConfig } from "./config.js";
import { createPool } from "./db.js";
import { postgresRegistry } from "./services.js";
import { postgresIncidents } from "./incident-repository.js";
import { createAuth, readAuthSecret } from "./auth.js";
import { postgresUsers } from "./auth-store.js";
import { postgresInvestigations } from "./investigations.js";

try {
  const config = readConfig();
  const secret = readAuthSecret();
  const pool = createPool(config);
  const server = createApp(
    postgresRegistry(pool),
    undefined,
    postgresIncidents(pool),
    createAuth(postgresUsers(pool), secret),
    postgresInvestigations(pool),
  ).listen(config.port, "127.0.0.1", () => {
    console.log(
      JSON.stringify({
        event: "listening",
        service: "sentinel-api",
        port: config.port,
      }),
    );
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  const shutdown = () => {
    const deadline = setTimeout(() => process.exit(1), 6000);
    deadline.unref();
    server.close(
      () =>
        void pool.end().then(
          () => process.exit(0),
          () => process.exit(1),
        ),
    );
    server.closeIdleConnections();
  };
  server.on("error", () => {
    console.error(
      "API could not listen; check port availability (details omitted)",
    );
    void pool.end().finally(() => process.exit(1));
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  console.error(
    "API configuration invalid; check database, TLS, port and JWT secret settings (values omitted)",
  );
  process.exitCode = 1;
}
