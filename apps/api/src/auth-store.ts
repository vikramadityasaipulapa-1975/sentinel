import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  AuthError,
  normalizeEmail,
  roles,
  type Role,
  type User,
  type UserStore,
} from "./auth.js";
import { hashPassword } from "./passwords.js";

export function postgresUsers(pool: Pool): UserStore {
  async function lookup(
    column: "id" | "email",
    value: string,
  ): Promise<User | null> {
    try {
      const result = await pool.query(
        `SELECT id, email, role, enabled, token_version, password_hash FROM sentinel_api.users WHERE ${column} = $1`,
        [value],
      );
      return result.rows[0] ?? null;
    } catch {
      throw new AuthError(
        503,
        "AUTH_UNAVAILABLE",
        "Authentication unavailable",
      );
    }
  }
  return {
    async ready() {
      return (
        (
          await pool.query(
            "SELECT to_regclass('sentinel_api.users') IS NOT NULL AND to_regclass('sentinel_api.login_limits') IS NOT NULL AS ready",
          )
        ).rows[0].ready === true
      );
    },
    byEmail: (email) => lookup("email", email),
    byId: (id) => lookup("id", id),
    async consumeLogin(keys) {
      const client = await pool.connect().catch(() => {
        throw new AuthError(
          503,
          "AUTH_UNAVAILABLE",
          "Authentication unavailable",
        );
      });
      try {
        await client.query("BEGIN");
        await client.query(
          "DELETE FROM sentinel_api.login_limits WHERE key IN (SELECT key FROM sentinel_api.login_limits WHERE window_start < statement_timestamp() - interval '1 day' LIMIT 100)",
        );
        let allowed = true;
        // Consistent key order prevents deadlocks between account and IP buckets.
        for (const item of [...keys].sort((a, b) =>
          a.key.localeCompare(b.key),
        )) {
          const result = await client.query(
            "INSERT INTO sentinel_api.login_limits (key, attempts) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET attempts = CASE WHEN login_limits.window_start <= statement_timestamp() - interval '15 minutes' THEN 1 ELSE LEAST(login_limits.attempts + 1, 1000000) END, window_start = CASE WHEN login_limits.window_start <= statement_timestamp() - interval '15 minutes' THEN statement_timestamp() ELSE login_limits.window_start END RETURNING attempts",
            [item.key],
          );
          allowed = result.rows[0].attempts <= item.limit && allowed;
        }
        await client.query("COMMIT");
        return allowed;
      } catch {
        await client.query("ROLLBACK");
        throw new AuthError(
          503,
          "AUTH_UNAVAILABLE",
          "Authentication unavailable",
        );
      } finally {
        client.release();
      }
    },
  };
}
export async function createUser(
  pool: Pool,
  email: string,
  password: string,
  role: Role,
): Promise<string> {
  const normalized = normalizeEmail(email);
  if (!roles.includes(role)) throw new Error("Invalid role");
  const hash = await hashPassword(password);
  const id = randomUUID();
  await pool.query(
    "INSERT INTO sentinel_api.users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)",
    [id, normalized, hash, role],
  );
  return id;
}
export async function manageUser(
  pool: Pool,
  action: string,
  email: string,
  role?: Role,
  password?: string,
): Promise<void> {
  const normalized = normalizeEmail(email);
  let result;
  if (action === "password") {
    const hash = await hashPassword(password ?? "");
    result = await pool.query(
      "UPDATE sentinel_api.users SET password_hash=$2, token_version=token_version+1, updated_at=statement_timestamp() WHERE email=$1 RETURNING id",
      [normalized, hash],
    );
  } else if (action === "role" && role && roles.includes(role)) {
    result = await pool.query(
      "UPDATE sentinel_api.users SET role=$2, updated_at=statement_timestamp() WHERE email=$1 RETURNING id",
      [normalized, role],
    );
  } else if (action === "enable" || action === "disable") {
    result = await pool.query(
      "UPDATE sentinel_api.users SET enabled=$2, token_version=token_version+1, updated_at=statement_timestamp() WHERE email=$1 RETURNING id",
      [normalized, action === "enable"],
    );
  } else throw new Error("Invalid account action");
  if (result.rowCount !== 1) throw new Error("User not found");
}
