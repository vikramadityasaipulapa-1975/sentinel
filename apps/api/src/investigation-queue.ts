import {
  collectInvestigation,
  evidenceConfig,
  type Evidence,
} from "./evidence.js";
import { Queue, Worker, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import { postgresInvestigations } from "./investigations.js";
import { uuidPattern } from "./services.js";

const queueName = "sentinel-investigations";
function prefix() {
  const value = process.env.SENTINEL_QUEUE_PREFIX ?? "sentinel";
  if (!/^sentinel(?:-verify-[0-9a-f]{8})?$/.test(value))
    throw new Error("Invalid queue prefix");
  return value;
}
export function readWorkDelay(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.SENTINEL_WORK_CHECK_DELAY_MS ?? "300");
  if (!Number.isInteger(value) || value < 0 || value > 4000)
    throw new Error("Invalid workflow delay");
  return value;
}
const safeError = () =>
  console.error(
    JSON.stringify({
      service: "sentinel-worker",
      event: "queue_or_worker_error",
    }),
  );
export function readRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  let url: URL;
  try {
    url = new URL(env.SENTINEL_REDIS_URL ?? "");
  } catch {
    throw new Error("SENTINEL_REDIS_URL is required");
  }
  if (
    !["redis:", "rediss:"].includes(url.protocol) ||
    !url.hostname ||
    !url.password ||
    url.search ||
    url.hash ||
    !/^\/(?:[0-9]|1[0-5])$/.test(url.pathname)
  )
    throw new Error("Invalid Redis URL");
  if (
    url.protocol === "redis:" &&
    !["127.0.0.1", "localhost", "api-redis"].includes(url.hostname)
  )
    throw new Error("Remote Redis requires TLS");
  return url.href;
}
export function createPublisher(url: string) {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1500,
    commandTimeout: 2000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    ...(url.startsWith("rediss:") ? { tls: { rejectUnauthorized: true } } : {}),
  });
  redis.on("error", safeError);
  const queue = new Queue(queueName, { connection: redis, prefix: prefix() });
  queue.on("error", safeError);
  return {
    queue,
    redis,
    async add(id: string) {
      if (redis.status !== "ready") throw new Error("Queue unavailable");
      await queue.add(
        "workflow-check",
        { investigation_id: id },
        {
          jobId: id,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    },
    async close() {
      await queue.close();
      redis.disconnect();
    },
  };
}
export async function dispatchOnce(
  pool: Pool,
  publish: (id: string) => Promise<void>,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = (
      await client.query(
        "SELECT o.investigation_id FROM sentinel_api.investigation_outbox o JOIN sentinel_api.investigations i ON i.id=o.investigation_id WHERE o.next_dispatch_at<=statement_timestamp() AND (i.status='QUEUED' OR (i.status='RUNNING' AND i.lease_until<=statement_timestamp())) ORDER BY o.next_dispatch_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED",
      )
    ).rows;
    for (const row of rows) {
      await publish(row.investigation_id);
      await client.query(
        "UPDATE sentinel_api.investigation_outbox SET dispatched_at=statement_timestamp(),next_dispatch_at=statement_timestamp()+interval '2 seconds' WHERE investigation_id=$1",
        [row.investigation_id],
      );
    }
    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
export function startInvestigationWorker(
  pool: Pool,
  url: string,
  execute?: (id: string) => Promise<void>,
) {
  const store = postgresInvestigations(pool);
  const delay = readWorkDelay();
  const collector = evidenceConfig();
  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 2000,
    ...(url.startsWith("rediss:") ? { tls: { rejectUnauthorized: true } } : {}),
  });
  redis.on("error", safeError);
  const worker = new Worker(
    queueName,
    async (job) => {
      const id = job.data?.investigation_id;
      if (
        job.name !== "workflow-check" ||
        typeof id !== "string" ||
        !uuidPattern.test(id) ||
        job.id !== id ||
        Object.keys(job.data).length !== 1
      )
        throw new UnrecoverableError("Invalid job contract");
      const claim = await store.claim(id, collector ? 30 : 15);
      if (!claim) return;
      let timer: NodeJS.Timeout | undefined;
      try {
        let evidence: Evidence[] | undefined;
        let analysis: unknown;
        await Promise.race([
          execute
            ? execute(id)
            : collector
              ? (async () => {
                  const row = (
                    await pool.query(
                      "SELECT s.name FROM sentinel_api.investigations v JOIN sentinel_api.incidents i ON i.id=v.incident_id JOIN sentinel_api.services s ON s.id=i.service_id WHERE v.id=$1",
                      [id],
                    )
                  ).rows[0];
                  const end = new Date();
                  const start = new Date(end.getTime() - 600000);
                  const collected = await collectInvestigation(
                    collector,
                    row.name,
                    start.toISOString(),
                    end.toISOString(),
                  );
                  evidence = collected.evidence;
                  analysis = collected.analysis;
                })()
              : (async () => {
                  await pool.query(
                    "SELECT id FROM sentinel_api.investigations WHERE id=$1",
                    [id],
                  );
                  await new Promise((resolve) => setTimeout(resolve, delay));
                })(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Workflow timeout")),
              collector ? 17000 : 5000,
            );
          }),
        ]);
        await store.finish(
          id,
          claim.token,
          true,
          evidence,
          "WORKFLOW_CHECK_FAILED",
          analysis,
        );
      } catch {
        await store.finish(
          id,
          claim.token,
          false,
          undefined,
          collector ? "EVIDENCE_COLLECTION_FAILED" : "WORKFLOW_CHECK_FAILED",
        );
        throw new Error("Workflow check failed");
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    {
      connection: redis,
      prefix: prefix(),
      concurrency: 2,
      lockDuration: 10000,
      stalledInterval: 5000,
      maxStalledCount: 1,
    },
  );
  worker.on("error", safeError);
  return {
    worker,
    async close() {
      await worker.close(true);
      redis.disconnect();
    },
  };
}
