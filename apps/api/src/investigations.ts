import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { uuidPattern } from "./services.js";
import {
  IncidentError,
  notFound,
  parseList,
  unavailable,
} from "./incidents.js";

export interface Investigation {
  id: string;
  incident_id: string;
  requested_by: string;
  status: string;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}
function timestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw unavailable();
  return value.toISOString();
}
function metadata(
  value: unknown,
  result: boolean,
): Record<string, unknown> | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw unavailable();
  const data = value as Record<string, unknown>;
  if (result) {
    if (
      data.mode !== "workflow-check" ||
      data.ai_performed !== false ||
      typeof data.message !== "string" ||
      data.message.length > 200
    )
      throw unavailable();
    return { mode: data.mode, ai_performed: false, message: data.message };
  }
  if (
    typeof data.code !== "string" ||
    !["ATTEMPTS_EXHAUSTED", "WORKFLOW_CHECK_FAILED"].includes(data.code)
  )
    throw unavailable();
  return { code: data.code };
}
export function readInvestigation(row: Record<string, unknown>): Investigation {
  if (
    typeof row.id !== "string" ||
    !uuidPattern.test(row.id) ||
    typeof row.incident_id !== "string" ||
    !uuidPattern.test(row.incident_id) ||
    typeof row.requested_by !== "string" ||
    !uuidPattern.test(row.requested_by) ||
    typeof row.status !== "string" ||
    !["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"].includes(
      row.status,
    ) ||
    typeof row.attempts !== "number" ||
    !Number.isInteger(row.attempts) ||
    row.attempts < 0 ||
    row.attempts > 3
  )
    throw unavailable();
  return {
    id: row.id,
    incident_id: row.incident_id,
    requested_by: row.requested_by,
    status: row.status,
    attempts: row.attempts,
    created_at: timestamp(row.created_at),
    started_at: row.started_at === null ? null : timestamp(row.started_at),
    finished_at: row.finished_at === null ? null : timestamp(row.finished_at),
    result: metadata(row.result_json, true),
    error: metadata(row.error_json, false),
  };
}
export function postgresInvestigations(pool: Pool) {
  async function transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      const value = await operation(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client?.query("ROLLBACK").catch(() => {});
      if (error instanceof IncidentError) throw error;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      )
        throw new IncidentError(
          409,
          "INVESTIGATION_CONFLICT",
          "An active investigation or request key already exists",
        );
      throw unavailable();
    } finally {
      client?.release();
    }
  }
  async function locked(client: PoolClient, id: string) {
    const reference = (
      await client.query(
        "SELECT incident_id FROM sentinel_api.investigations WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!reference)
      throw new IncidentError(
        404,
        "INVESTIGATION_NOT_FOUND",
        "Investigation not found",
      );
    // Every timeline writer takes the incident lock first: sequence order equals commit order per incident.
    await client.query(
      "SELECT id FROM sentinel_api.incidents WHERE id=$1 FOR UPDATE",
      [reference.incident_id],
    );
    return (
      await client.query(
        "SELECT *,lease_until>clock_timestamp() AS lease_valid FROM sentinel_api.investigations WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
  }
  async function event(
    client: PoolClient,
    row: Record<string, unknown>,
    kind: string,
  ) {
    await client.query(
      "INSERT INTO sentinel_api.incident_events (id, incident_id, investigation_id, type, payload_json) VALUES ($1,$2,$3,'INVESTIGATION',$4)",
      [
        randomUUID(),
        row.incident_id,
        row.id,
        JSON.stringify({
          investigation_id: row.id,
          status: row.status,
          event: kind,
          attempt: String(row.attempts),
        }),
      ],
    );
  }
  return {
    async ready() {
      try {
        return (
          (
            await pool.query(
              "SELECT to_regclass('sentinel_api.investigation_outbox') IS NOT NULL AND to_regclass('sentinel_api.investigations') IS NOT NULL AS ready",
            )
          ).rows[0].ready === true
        );
      } catch {
        return false;
      }
    },
    enqueue: (incidentId: string, userId: string, key: string) =>
      transaction(async (client) => {
        const incident = (
          await client.query(
            "SELECT id,status FROM sentinel_api.incidents WHERE id=$1 FOR UPDATE",
            [incidentId],
          )
        ).rows[0];
        if (!incident) throw notFound();
        const previous = (
          await client.query(
            "SELECT * FROM sentinel_api.investigations WHERE requested_by=$1 AND idempotency_key=$2",
            [userId, key],
          )
        ).rows[0];
        if (previous) {
          if (previous.incident_id !== incidentId)
            throw new IncidentError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Request key belongs to another incident",
            );
          return readInvestigation(previous);
        }
        if (incident.status === "CLOSED")
          throw new IncidentError(
            409,
            "INCIDENT_CLOSED",
            "Closed incidents cannot start new investigations",
          );
        const row = (
          await client.query(
            "INSERT INTO sentinel_api.investigations (id,incident_id,requested_by,idempotency_key) VALUES ($1,$2,$3,$4) RETURNING *",
            [randomUUID(), incidentId, userId, key],
          )
        ).rows[0];
        await client.query(
          "INSERT INTO sentinel_api.investigation_outbox (investigation_id) VALUES ($1)",
          [row.id],
        );
        await event(client, row, "QUEUED");
        return readInvestigation(row);
      }),
    async get(id: string) {
      try {
        const row = (
          await pool.query(
            "SELECT * FROM sentinel_api.investigations WHERE id=$1",
            [id],
          )
        ).rows[0];
        if (!row)
          throw new IncidentError(
            404,
            "INVESTIGATION_NOT_FOUND",
            "Investigation not found",
          );
        return readInvestigation(row);
      } catch (error) {
        if (error instanceof IncidentError) throw error;
        throw unavailable();
      }
    },
    list: (incidentId: string, query: unknown) =>
      transaction(async (client) => {
        if (
          !(
            await client.query(
              "SELECT id FROM sentinel_api.incidents WHERE id=$1",
              [incidentId],
            )
          ).rows[0]
        )
          throw notFound();
        // Reuse validated event-style cursors, scoped separately to this collection.
        const scope = `investigations-${incidentId}`;
        const options = parseList(query, scope);
        const rows = (
          await client.query(
            "SELECT * FROM sentinel_api.investigations WHERE incident_id=$1 AND ($2::bigint IS NULL OR position<$2) ORDER BY position DESC LIMIT $3",
            [incidentId, options.position ?? null, options.limit + 1],
          )
        ).rows;
        const page = rows.slice(0, options.limit);
        const { encodeCursor, eventScope } = await import("./incidents.js");
        return {
          investigations: page.map(readInvestigation),
          next_cursor:
            rows.length > options.limit
              ? encodeCursor(page[page.length - 1].position, eventScope(scope))
              : null,
        };
      }),
    claim: (id: string) =>
      transaction(async (client) => {
        const row = await locked(client, id);
        if (
          !["QUEUED", "RUNNING"].includes(row.status) ||
          (row.status === "RUNNING" && row.lease_valid === true)
        )
          return null;
        if (row.attempts >= 3) {
          const failed = (
            await client.query(
              "UPDATE sentinel_api.investigations SET status='FAILED',lease_token=NULL,lease_until=NULL,finished_at=statement_timestamp(),error_json=$2 WHERE id=$1 RETURNING *",
              [id, JSON.stringify({ code: "ATTEMPTS_EXHAUSTED" })],
            )
          ).rows[0];
          await event(client, failed, "FAILED");
          await client.query(
            "DELETE FROM sentinel_api.investigation_outbox WHERE investigation_id=$1",
            [id],
          );
          return null;
        }
        const claimed = (
          await client.query(
            "UPDATE sentinel_api.investigations SET status='RUNNING',attempts=attempts+1,lease_token=$2,lease_until=statement_timestamp()+interval '15 seconds',started_at=COALESCE(started_at,statement_timestamp()) WHERE id=$1 RETURNING *",
            [id, randomUUID()],
          )
        ).rows[0];
        await event(client, claimed, "RUNNING");
        return {
          token: claimed.lease_token as string,
          investigation: readInvestigation(claimed),
        };
      }),
    finish: (id: string, token: string, success: boolean) =>
      transaction(async (client) => {
        const current = await locked(client, id);
        if (
          current.status !== "RUNNING" ||
          current.lease_token !== token ||
          current.lease_valid !== true
        )
          return false;
        const status = success
          ? "COMPLETED"
          : current.attempts >= 3
            ? "FAILED"
            : "QUEUED";
        const result = success
          ? {
              mode: "workflow-check",
              ai_performed: false,
              message:
                "Queue and persistence workflow checked; no telemetry gathered or AI investigation performed",
            }
          : null;
        const updated = (
          await client.query(
            "UPDATE sentinel_api.investigations SET status=$2,lease_token=NULL,lease_until=NULL,finished_at=CASE WHEN $2 IN ('COMPLETED','FAILED') THEN statement_timestamp() ELSE NULL END,result_json=$3,error_json=$4 WHERE id=$1 RETURNING *",
            [
              id,
              status,
              result ? JSON.stringify(result) : null,
              success
                ? null
                : JSON.stringify({ code: "WORKFLOW_CHECK_FAILED" }),
            ],
          )
        ).rows[0];
        await event(
          client,
          updated,
          success
            ? "COMPLETED"
            : status === "FAILED"
              ? "FAILED"
              : "RETRY_SCHEDULED",
        );
        if (status === "QUEUED")
          await client.query(
            "UPDATE sentinel_api.investigation_outbox SET next_dispatch_at=statement_timestamp()+interval '2 seconds' WHERE investigation_id=$1",
            [id],
          );
        else
          await client.query(
            "DELETE FROM sentinel_api.investigation_outbox WHERE investigation_id=$1",
            [id],
          );
        return true;
      }),
  };
}
export type InvestigationStore = ReturnType<typeof postgresInvestigations>;
