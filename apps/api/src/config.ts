export interface Config {
  databaseUrl: string;
  databaseTls: boolean;
  databaseCa?: string;
  port: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let url: URL;
  try {
    url = new URL(env.SENTINEL_DATABASE_URL ?? "");
  } catch {
    throw new Error("SENTINEL_DATABASE_URL must be a PostgreSQL URL");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.pathname.length < 2 ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Invalid database URL; use separate TLS settings, without URL query parameters",
    );
  }
  const mode = env.SENTINEL_DATABASE_TLS ?? "verify-full";
  if (mode !== "disable" && mode !== "verify-full")
    throw new Error("Invalid SENTINEL_DATABASE_TLS");
  if (
    mode === "disable" &&
    !["localhost", "127.0.0.1", "api-db"].includes(url.hostname)
  ) {
    throw new Error("Remote databases require verified TLS");
  }
  if (env.SENTINEL_DATABASE_CA && mode === "disable")
    throw new Error("CA requires verified TLS");
  const rawPort = env.SENTINEL_API_PORT ?? "3000";
  const port = Number(rawPort);
  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("Invalid SENTINEL_API_PORT");
  }
  return {
    databaseUrl: url.href,
    databaseTls: mode === "verify-full",
    databaseCa: env.SENTINEL_DATABASE_CA,
    port,
  };
}
