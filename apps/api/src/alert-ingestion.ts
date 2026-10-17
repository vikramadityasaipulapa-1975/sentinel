import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { Router } from "express";
import express from "express";
import { AuthError } from "./auth.js";

const invalid = () =>
  new AuthError(
    422,
    "INVALID_ALERT",
    "Invalid or unsupported alert notification",
  );
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function readWebhookSecret(env: NodeJS.ProcessEnv = process.env) {
  const value = env.SENTINEL_ALERT_WEBHOOK_SECRET;
  if (value === undefined) return undefined;
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error("Webhook secret must be 64 random hexadecimal characters");
  return value;
}
export function parseAlert(body: unknown) {
  if (
    !object(body) ||
    body.version !== "4" ||
    body.receiver !== "sentinel" ||
    !["firing", "resolved"].includes(String(body.status)) ||
    !Array.isArray(body.alerts) ||
    body.alerts.length < 1 ||
    body.alerts.length > 20 ||
    (body.truncatedAlerts !== undefined && body.truncatedAlerts !== 0)
  )
    throw invalid();
  const group = body.groupLabels;
  if (
    !object(group) ||
    group.alertname !== "CheckoutHighErrorRate" ||
    group.service !== "checkout-service"
  )
    throw invalid();
  const starts: number[] = [];
  let firing = false;
  for (const alert of body.alerts) {
    if (
      !object(alert) ||
      !object(alert.labels) ||
      alert.labels.service !== group.service ||
      alert.labels.alertname !== group.alertname ||
      !["firing", "resolved"].includes(String(alert.status)) ||
      typeof alert.startsAt !== "string" ||
      alert.startsAt.length > 40
    )
      throw invalid();
    const start = Date.parse(alert.startsAt);
    if (
      !Number.isFinite(start) ||
      start > Date.now() + 300000 ||
      start < Date.now() - 30 * 86400000
    )
      throw invalid();
    if (alert.status === "resolved") {
      const end =
        typeof alert.endsAt === "string" ? Date.parse(alert.endsAt) : NaN;
      if (!Number.isFinite(end) || end < start || end > Date.now() + 300000)
        throw invalid();
    } else firing = true;
    starts.push(start);
  }
  if ((body.status === "firing") !== firing) throw invalid();
  const startsAt = new Date(Math.min(...starts)).toISOString();
  const key = createHash("sha256")
    .update(`checkout-service|CheckoutHighErrorRate|${startsAt}`)
    .digest("hex");
  return {
    key,
    startsAt,
    status: firing ? ("firing" as const) : ("resolved" as const),
  };
}
export type AlertInput = ReturnType<typeof parseAlert>;
export function postgresAlerts(pool: Pool, secret: string) {
  if (!/^[a-f0-9]{64}$/.test(secret))
    throw new Error("Invalid webhook key configuration");
  return {
    secret,
    async ready() {
      return (
        (
          await pool.query(
            "SELECT to_regclass('sentinel_api.alert_episodes') IS NOT NULL AS ready",
          )
        ).rows[0].ready === true
      );
    },
    async ingest(input: AlertInput) {
      const client = await pool.connect().catch(() => {
        throw new AuthError(
          503,
          "ALERT_INGESTION_UNAVAILABLE",
          "Alert storage unavailable",
        );
      });
      try {
        await client.query("BEGIN");
        // Lock a canonical episode before any read/create: repeats across API instances serialize.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 8174))",
          [input.key],
        );
        const old = (
          await client.query(
            "SELECT * FROM sentinel_api.alert_episodes WHERE episode_key=$1 FOR UPDATE",
            [input.key],
          )
        ).rows[0];
        if (old) {
          await client.query(
            "UPDATE sentinel_api.alert_episodes SET notifications=LEAST(notifications+1,1000000000), signal_status=CASE WHEN signal_status='resolved' THEN 'resolved' ELSE $2 END, last_seen_at=statement_timestamp() WHERE episode_key=$1",
            [input.key, input.status],
          );
          await client.query("COMMIT");
          return {
            incident_id: old.incident_id as string | null,
            created: false,
          };
        }
        const service = (
          await client.query(
            "SELECT id FROM sentinel_api.services WHERE name='checkout-service'",
          )
        ).rows[0];
        if (!service) throw new Error("Service registry unavailable");
        let incident: string | null = null;
        if (input.status === "firing") {
          incident = randomUUID();
          await client.query(
            "INSERT INTO sentinel_api.incidents(id,service_id,title,severity) VALUES($1,$2,'Alert: sustained checkout error rate','HIGH')",
            [incident, service.id],
          );
          await client.query(
            "INSERT INTO sentinel_api.incident_events(id,incident_id,type,payload_json) VALUES($1,$2,'CREATED',$3)",
            [randomUUID(), incident, JSON.stringify({ status: "OPEN" })],
          );
        }
        await client.query(
          "INSERT INTO sentinel_api.alert_episodes(episode_key,service_id,alert_name,starts_at,signal_status,incident_id) VALUES($1,$2,'CheckoutHighErrorRate',$3,$4,$5)",
          [input.key, service.id, input.startsAt, input.status, incident],
        );
        await client.query("COMMIT");
        return { incident_id: incident, created: incident !== null };
      } catch {
        await client.query("ROLLBACK");
        throw new AuthError(
          503,
          "ALERT_INGESTION_UNAVAILABLE",
          "Alert storage unavailable",
        );
      } finally {
        client.release();
      }
    },
  };
}
export type AlertStore = ReturnType<typeof postgresAlerts>;
export function alertRoutes(store?: AlertStore) {
  const router = Router();
  let active = 0;
  router.post(
    "/",
    (request, _response, next) => {
      if (!store)
        throw new AuthError(
          503,
          "ALERT_INGESTION_UNAVAILABLE",
          "Alert ingestion is not configured",
        );
      const header = request.get("authorization") ?? "";
      const expected = `Bearer ${store.secret}`;
      if (
        Buffer.byteLength(header) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(header), Buffer.from(expected))
      )
        throw new AuthError(
          401,
          "UNAUTHORIZED",
          "Valid webhook credentials required",
        );
      if (!request.is("application/json"))
        throw new AuthError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json",
        );
      next();
    },
    express.json({ limit: "64kb" }),
    async (request, response) => {
      if (active >= 2)
        throw new AuthError(
          503,
          "AUTH_BUSY",
          "Alert ingestion busy; retry shortly",
        );
      const input = parseAlert(request.body);
      active++;
      try {
        response.status(202).json(await store!.ingest(input));
      } finally {
        active--;
      }
    },
  );
  return router;
}
