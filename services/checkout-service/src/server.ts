import { createApp } from "./app.js";

const host = "127.0.0.1";
const port = 3001;
function startupFailure(code: string) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      service: "checkout-service",
      event: "startup_failed",
      code,
    }),
  );
  process.exitCode = 1;
}

try {
  const server = createApp().listen(port, host, () => {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "info",
        service: "checkout-service",
        event: "server_started",
        host,
        port,
      }),
    );
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    startupFailure(
      error.code === "EADDRINUSE" || error.code === "EACCES"
        ? error.code
        : "STARTUP_FAILED",
    );
  });
} catch {
  startupFailure("INVALID_CONFIGURATION");
}
