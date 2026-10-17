import { readConfig } from "./config.js";
import { createPool } from "./db.js";
import {
  createPublisher,
  dispatchOnce,
  readRedisUrl,
  startInvestigationWorker,
} from "./investigation-queue.js";
import { postgresInvestigations } from "./investigations.js";

const pool = createPool(readConfig());
let stopped = false;
let publisher: ReturnType<typeof createPublisher> | undefined;
let consumer: ReturnType<typeof startInvestigationWorker> | undefined;
const shutdown = () => {
  stopped = true;
  setTimeout(() => process.exit(1), 6000).unref();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
try {
  const url = readRedisUrl();
  if (!(await postgresInvestigations(pool).ready()))
    throw new Error("Missing investigation schema");
  publisher = createPublisher(url);
  consumer = startInvestigationWorker(pool, url);
  console.log(
    JSON.stringify({
      service: "sentinel-worker",
      event: "started",
      mode: process.env.SENTINEL_EVIDENCE_URL
        ? "deterministic-evidence"
        : "workflow-check",
    }),
  );
  while (!stopped) {
    try {
      await dispatchOnce(pool, publisher.add);
    } catch {
      console.error(
        JSON.stringify({
          service: "sentinel-worker",
          event: "dispatch_unavailable",
        }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} catch {
  console.error(
    "Worker startup failed; check database/schema and Redis settings (values omitted)",
  );
  process.exitCode = 1;
} finally {
  await consumer?.close();
  await publisher?.close();
  await pool.end();
}
