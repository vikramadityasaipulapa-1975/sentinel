import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  assertTransition,
  encodeCursor,
  eventScope,
  IncidentError,
  listScope,
  notFound,
  readEvent,
  readIncident,
  unavailable,
  type IncidentStore,
} from "./incidents.js";

export function postgresIncidents(pool: Pool): IncidentStore {
  async function database<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof IncidentError) throw error;
      throw unavailable();
    }
  }
  async function transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return database(async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
  }
  return {
    ready: () =>
      database(
        async () =>
          (
            await pool.query(
              "SELECT to_regclass('sentinel_api.incidents') IS NOT NULL AND to_regclass('sentinel_api.incident_events') IS NOT NULL AS ready",
            )
          ).rows[0].ready === true,
      ),
    create: (input) =>
      transaction(async (client) => {
        let result;
        try {
          result = await client.query(
            "INSERT INTO sentinel_api.incidents (id, service_id, title, severity) VALUES ($1, $2, $3, $4) RETURNING *",
            [randomUUID(), input.service_id, input.title, input.severity],
          );
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "23503"
          )
            throw new IncidentError(
              404,
              "SERVICE_NOT_FOUND",
              "Registered service not found",
            );
          throw error;
        }
        const incident = readIncident(result.rows[0]);
        await client.query(
          "INSERT INTO sentinel_api.incident_events (id, incident_id, type, payload_json) VALUES ($1, $2, 'CREATED', $3)",
          [randomUUID(), incident.id, JSON.stringify({ status: "OPEN" })],
        );
        return incident;
      }),
    list: (options) =>
      database(async () => {
        const values: unknown[] = [];
        const conditions: string[] = [];
        for (const [column, value] of [
          ["status", options.status],
          ["service_id", options.service_id],
          ["list_position", options.position],
        ] as const) {
          if (value !== undefined) {
            values.push(value);
            conditions.push(
              `${column} ${column === "list_position" ? "<" : "="} $${values.length}`,
            );
          }
        }
        values.push(options.limit + 1);
        // Only source-owned column names/operators are interpolated; values are parameters.
        const result = await pool.query(
          `SELECT * FROM sentinel_api.incidents ${conditions.length ? "WHERE " + conditions.join(" AND ") : ""} ORDER BY list_position DESC LIMIT $${values.length}`,
          values,
        );
        const rows = result.rows.slice(0, options.limit);
        return {
          incidents: rows.map(readIncident),
          next_cursor:
            result.rows.length > options.limit
              ? encodeCursor(
                  rows[rows.length - 1].list_position,
                  listScope(options),
                )
              : null,
        };
      }),
    get: (id) =>
      database(async () => {
        const result = await pool.query(
          "SELECT * FROM sentinel_api.incidents WHERE id = $1",
          [id],
        );
        if (!result.rows[0]) throw notFound();
        return readIncident(result.rows[0]);
      }),
    transition: (id, status) =>
      transaction(async (client) => {
        const result = await client.query(
          "SELECT * FROM sentinel_api.incidents WHERE id = $1 FOR UPDATE",
          [id],
        );
        if (!result.rows[0]) throw notFound();
        const current = readIncident(result.rows[0]);
        assertTransition(current.status, status);
        if (current.status === status) return current;
        const updated = await client.query(
          "UPDATE sentinel_api.incidents SET status = $2, resolved_at = CASE WHEN $2 = 'CLOSED' THEN resolved_at WHEN $2 = 'RESOLVED' THEN statement_timestamp() ELSE NULL END WHERE id = $1 RETURNING *",
          [id, status],
        );
        const incident = readIncident(updated.rows[0]);
        await client.query(
          "INSERT INTO sentinel_api.incident_events (id, incident_id, type, payload_json) VALUES ($1, $2, 'STATUS_CHANGED', $3)",
          [
            randomUUID(),
            id,
            JSON.stringify({ from_status: current.status, to_status: status }),
          ],
        );
        return incident;
      }),
    events: (id, options) =>
      database(async () => {
        if (
          !(
            await pool.query(
              "SELECT id FROM sentinel_api.incidents WHERE id = $1",
              [id],
            )
          ).rows[0]
        )
          throw notFound();
        const result = await pool.query(
          "SELECT * FROM sentinel_api.incident_events WHERE incident_id = $1 AND sequence > $2::bigint ORDER BY sequence ASC LIMIT $3",
          [id, options.position ?? "0", options.limit + 1],
        );
        const rows = result.rows.slice(0, options.limit);
        return {
          events: rows.map(readEvent),
          next_cursor:
            result.rows.length > options.limit
              ? encodeCursor(rows[rows.length - 1].sequence, eventScope(id))
              : null,
        };
      }),
  };
}
