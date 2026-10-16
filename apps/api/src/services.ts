import type { Pool } from "pg";

export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface RegisteredService {
  id: string;
  name: string;
  owner: string;
  environment: string;
  created_at: string;
}
export interface Registry {
  ready(): Promise<boolean>;
  list(): Promise<unknown[]>;
}
export class RegistryUnavailable extends Error {}
export class InvalidRegistryResponse extends Error {}

export function postgresRegistry(pool: Pool): Registry {
  return {
    async ready() {
      const result = await pool.query(
        "SELECT to_regclass('sentinel_api.services') IS NOT NULL AS ready",
      );
      return result.rows[0]?.ready === true;
    },
    async list() {
      try {
        const result = await pool.query(
          "SELECT id, name, owner, environment, created_at FROM sentinel_api.services ORDER BY name LIMIT 101",
        );
        return result.rows;
      } catch {
        throw new RegistryUnavailable();
      }
    },
  };
}

// Treat database results as unknown, and expose only the documented fields.
export async function listServices(
  registry: Registry,
): Promise<RegisteredService[]> {
  const rows = await registry.list();
  if (rows.length > 100) throw new InvalidRegistryResponse();
  return rows.map((value) => {
    if (!value || typeof value !== "object")
      throw new InvalidRegistryResponse();
    const row = value as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      !uuidPattern.test(row.id) ||
      typeof row.name !== "string" ||
      !/^[a-z][a-z0-9-]{0,62}$/.test(row.name) ||
      typeof row.owner !== "string" ||
      row.owner.length < 1 ||
      row.owner.length > 100 ||
      typeof row.environment !== "string" ||
      !["development", "staging", "production"].includes(row.environment) ||
      !(row.created_at instanceof Date) ||
      !Number.isFinite(row.created_at.getTime())
    ) {
      throw new InvalidRegistryResponse();
    }
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      environment: row.environment,
      created_at: row.created_at.toISOString(),
    };
  });
}
