export interface Config {
  paymentUrl: string;
  paymentTimeoutMs: number;
  paymentMaxAttempts?: number;
  paymentTotalTimeoutMs?: number;
  paymentMaxInflight?: number;
  paymentCircuitEnabled?: boolean;
  paymentCircuitThreshold?: number;
  paymentCircuitCooldownMs?: number;
}

export function paymentLimits(config: Config) {
  const limits = {
    totalTimeoutMs: config.paymentTotalTimeoutMs ?? 4500,
    maxInflight: config.paymentMaxInflight ?? 16,
    circuitEnabled: config.paymentCircuitEnabled ?? true,
    threshold: config.paymentCircuitThreshold ?? 5,
    cooldownMs: config.paymentCircuitCooldownMs ?? 10000,
  };
  for (const [value, minimum, maximum] of [
    [limits.totalTimeoutMs, 50, 25000],
    [limits.maxInflight, 1, 64],
    [limits.threshold, 1, 100],
    [limits.cooldownMs, 100, 60000],
  ])
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error("Invalid bounded payment resilience configuration");
  if (typeof limits.circuitEnabled !== "boolean")
    throw new Error("Invalid payment circuit configuration");
  return limits;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = new URL(env.PAYMENT_URL ?? "http://127.0.0.1:3002");
  // This phase permits only local demo services, never request-supplied targets.
  if (
    url.protocol !== "http:" ||
    !(
      env.CONTAINER_MODE === "1"
        ? ["127.0.0.1", "localhost", "payment"]
        : ["127.0.0.1", "localhost"]
    ).includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("PAYMENT_URL must be a local HTTP origin");
  }
  const timeout = Number(env.PAYMENT_TIMEOUT_MS ?? "2000");
  if (!Number.isInteger(timeout) || timeout < 50 || timeout > 10_000) {
    throw new Error("PAYMENT_TIMEOUT_MS must be an integer from 50 to 10000");
  }
  const attempts = Number(env.PAYMENT_MAX_ATTEMPTS ?? "2");
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 2) {
    throw new Error("PAYMENT_MAX_ATTEMPTS must be 1 or 2");
  }
  if (
    env.PAYMENT_CIRCUIT_ENABLED !== undefined &&
    !["true", "false"].includes(env.PAYMENT_CIRCUIT_ENABLED)
  )
    throw new Error("PAYMENT_CIRCUIT_ENABLED must be true or false");
  const config: Config = {
    paymentUrl: url.origin,
    paymentTimeoutMs: timeout,
    paymentMaxAttempts: attempts,
    paymentTotalTimeoutMs: Number(env.PAYMENT_TOTAL_TIMEOUT_MS ?? "4500"),
    paymentMaxInflight: Number(env.PAYMENT_MAX_INFLIGHT ?? "16"),
    paymentCircuitEnabled: env.PAYMENT_CIRCUIT_ENABLED !== "false",
    paymentCircuitThreshold: Number(
      env.PAYMENT_CIRCUIT_FAILURE_THRESHOLD ?? "5",
    ),
    paymentCircuitCooldownMs: Number(
      env.PAYMENT_CIRCUIT_COOLDOWN_MS ?? "10000",
    ),
  };
  paymentLimits(config);
  return config;
}
