import { createUser, manageUser } from "./auth-store.js";
import { roles, type Role } from "./auth.js";
import { readConfig } from "./config.js";
import { createPool } from "./db.js";
import type { Pool } from "pg";

let pool: Pool | undefined;
try {
  const config = readConfig();
  const url = new URL(config.databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    !["/sentinel_api", "/sentinel_api_verify"].includes(url.pathname) ||
    config.databaseTls
  )
    throw new Error("Local account tool only");
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer) > 4096) throw new Error("Input too large");
  }
  const input = JSON.parse(buffer);
  if (
    !input ||
    typeof input.email !== "string" ||
    !["create", "password", "role", "enable", "disable"].includes(input.action)
  )
    throw new Error("Invalid account input");
  if (["create", "role"].includes(input.action) && !roles.includes(input.role))
    throw new Error("Explicit role required");
  pool = createPool(config);
  if (input.action === "create")
    await createUser(pool, input.email, input.password, input.role as Role);
  else
    await manageUser(
      pool,
      input.action,
      input.email,
      input.role,
      input.password,
    );
  console.log("Local account operation completed; credentials omitted");
} catch {
  console.error(
    "Local account operation failed; check input, password policy, existing account and migrated database (values omitted)",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
