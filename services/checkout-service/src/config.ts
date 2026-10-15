export interface Config {
  paymentUrl: string;
  paymentTimeoutMs: number;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = new URL(env.PAYMENT_URL ?? "http://127.0.0.1:3002");
  // This phase permits only local demo services, never request-supplied targets.
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PAYMENT_URL must be a local HTTP origin");
  }
  const timeout = Number(env.PAYMENT_TIMEOUT_MS ?? "2000");
  if (!Number.isInteger(timeout) || timeout < 50 || timeout > 10_000) {
    throw new Error("PAYMENT_TIMEOUT_MS must be an integer from 50 to 10000");
  }
  return { paymentUrl: url.origin, paymentTimeoutMs: timeout };
}
