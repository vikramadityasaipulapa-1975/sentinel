import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { IncidentError, unavailable } from "./incidents.js";
import {
  ACTION,
  SANDBOX,
  dryRun,
  denied,
  parseProposal,
  type SandboxBinding,
} from "./remediation-policy.js";

export interface ActionAuthority {
  version: number;
  expires_at: number;
}

function publicAction(row: Record<string, unknown>) {
  const {
    execution_token: _executionToken,
    approver_token_version: _tokenVersion,
    ...safe
  } = row;
  return { ...safe, id: row.id as string, status: row.status as string };
}
export function postgresRemediations(pool: Pool) {
  async function transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (error) {
      await c.query("ROLLBACK");
      if (error instanceof IncidentError) throw error;
      if ((error as { code?: string }).code === "23505")
        throw new IncidentError(
          409,
          "ACTION_CONFLICT",
          "A sandbox proposal is already active",
        );
      throw unavailable();
    } finally {
      c.release();
    }
  }
  async function incident(c: PoolClient, id: string) {
    const row = (
      await c.query(
        "SELECT i.*,s.name AS service FROM sentinel_api.incidents i JOIN sentinel_api.services s ON s.id=i.service_id WHERE i.id=$1 FOR UPDATE OF i",
        [id],
      )
    ).rows[0];
    if (!row) throw new IncidentError(404, "NOT_FOUND", "Incident not found");
    return row;
  }
  async function user(
    c: PoolClient,
    id: string,
    admin = false,
    authority?: ActionAuthority,
  ) {
    const row = (
      await c.query(
        "SELECT id,role,enabled,token_version FROM sentinel_api.users WHERE id=$1 FOR SHARE",
        [id],
      )
    ).rows[0];
    if (
      !row ||
      !row.enabled ||
      !(admin ? row.role === "ADMIN" : ["OPERATOR", "ADMIN"].includes(row.role))
    )
      throw new IncidentError(403, "FORBIDDEN", "Action permission denied");
    if (
      authority &&
      (row.token_version !== authority.version ||
        !(
          await c.query(
            "SELECT $1::bigint>extract(epoch from statement_timestamp()) AS valid",
            [authority.expires_at],
          )
        ).rows[0].valid)
    )
      throw new IncidentError(
        403,
        "FORBIDDEN",
        "Session changed or expired before action transaction",
      );
    return row;
  }
  async function audit(
    c: PoolClient,
    row: Record<string, unknown>,
    actor: string | null,
    observations: unknown = null,
  ) {
    await c.query(
      "INSERT INTO sentinel_api.remediation_events(action_id,status,actor_id,observations) VALUES ($1,$2,$3,$4)",
      [row.id, row.status, actor, observations],
    );
    await c.query(
      "INSERT INTO sentinel_api.incident_events(id,incident_id,type,remediation_id,payload_json) VALUES ($1,$2,'REMEDIATION',$3,$4)",
      [
        randomUUID(),
        row.incident_id,
        row.id,
        JSON.stringify({ remediation_id: row.id, status: row.status }),
      ],
    );
  }
  async function current(c: PoolClient, id: string) {
    const row = (
      await c.query(
        "SELECT * FROM sentinel_api.remediation_actions WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!row) throw new IncidentError(404, "NOT_FOUND", "Action not found");
    return row;
  }
  async function target(c: PoolClient) {
    const row = (
      await c.query(
        "SELECT binding_json FROM sentinel_api.sandbox_binding WHERE project=$1 AND registered_at>statement_timestamp()-interval '30 minutes' FOR SHARE",
        [SANDBOX],
      )
    ).rows[0];
    if (!row) denied("Prepare and register the local sandbox first");
    return row.binding_json as SandboxBinding;
  }
  async function expire(c: PoolClient) {
    const rows = (
      await c.query(
        "UPDATE sentinel_api.remediation_actions SET status='EXPIRED',decided_by=NULL,approver_token_version=NULL,decided_at=NULL WHERE status IN ('PENDING','APPROVED') AND expires_at<=statement_timestamp() RETURNING *",
      )
    ).rows;
    for (const row of rows) await audit(c, row, null);
  }
  return {
    preview: (input: unknown) =>
      transaction(async (c) => {
        const req = parseProposal(input);
        const i = await incident(c, req.incident_id);
        return dryRun(i.service, i.status, await target(c));
      }),
    propose: (input: unknown, actor: string, authority?: ActionAuthority) =>
      transaction(async (c) => {
        const req = parseProposal(input);
        await c.query("SELECT pg_advisory_xact_lock(71628001)");
        await user(c, actor, false, authority);
        const i = await incident(c, req.incident_id);
        const old = (
          await c.query(
            "SELECT * FROM sentinel_api.remediation_actions WHERE requested_by=$1 AND idempotency_key=$2",
            [actor, req.idempotency_key],
          )
        ).rows[0];
        if (old) {
          if (old.incident_id !== req.incident_id)
            throw new IncidentError(
              409,
              "KEY_CONFLICT",
              "Request key was used for another incident",
            );
          return publicAction(old);
        }
        await expire(c);
        const binding = await target(c);
        dryRun(i.service, i.status, binding);
        const row = (
          await c.query(
            "INSERT INTO sentinel_api.remediation_actions(id,incident_id,requested_by,idempotency_key,project,action,binding_json) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              randomUUID(),
              i.id,
              actor,
              req.idempotency_key,
              SANDBOX,
              ACTION,
              JSON.stringify(binding),
            ],
          )
        ).rows[0];
        await audit(c, row, actor);
        return publicAction(row);
      }),
    decide: (
      id: string,
      decision: "APPROVE" | "REJECT",
      actor: string,
      authority?: ActionAuthority,
    ) =>
      transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(71628001)");
        const u = await user(c, actor, true, authority);
        const row = await current(c, id);
        if (row.status !== "PENDING") return publicAction(row);
        if (
          (
            await c.query(
              "SELECT $1::timestamptz>statement_timestamp() AS valid",
              [row.expires_at],
            )
          ).rows[0].valid !== true
        ) {
          const expired = (
            await c.query(
              "UPDATE sentinel_api.remediation_actions SET status='EXPIRED' WHERE id=$1 RETURNING *",
              [id],
            )
          ).rows[0];
          await audit(c, expired, actor);
          return publicAction(expired);
        }
        const updated = (
          await c.query(
            "UPDATE sentinel_api.remediation_actions SET status=$2,decided_by=$3,approver_token_version=$4,decided_at=statement_timestamp() WHERE id=$1 RETURNING *",
            [
              id,
              decision === "APPROVE" ? "APPROVED" : "REJECTED",
              actor,
              u.token_version,
            ],
          )
        ).rows[0];
        await audit(c, updated, actor);
        return publicAction(updated);
      }),
    get: (id: string) =>
      transaction(async (c) => {
        const row = await current(c, id);
        const events = (
          await c.query(
            "SELECT sequence::text,status,actor_id,observations,created_at FROM sentinel_api.remediation_events WHERE action_id=$1 ORDER BY sequence LIMIT 20",
            [id],
          )
        ).rows;
        return { ...publicAction(row), events };
      }),
    list: (id: string) =>
      transaction(async (c) =>
        (
          await c.query(
            "SELECT * FROM sentinel_api.remediation_actions WHERE incident_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20",
            [id],
          )
        ).rows.map(publicAction),
      ),
  };
}
export type RemediationStore = ReturnType<typeof postgresRemediations>;
