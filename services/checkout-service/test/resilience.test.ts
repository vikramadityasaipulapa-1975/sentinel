import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";
import { paymentLimits, readConfig } from "../src/config.js";
import { PaymentGate } from "../src/resilience.js";

const order = {
  order_id: "11111111-1111-4111-8111-111111111111",
  amount_minor: 100,
  currency: "INR",
};
const result = {
  ...order,
  payment_id: "22222222-2222-4222-8222-222222222222",
  status: "succeeded",
};
const options = paymentLimits({
  paymentUrl: "http://127.0.0.1:1",
  paymentTimeoutMs: 1000,
});

test("breaker uses one half-open probe, ignores old completions and reopens on failed probe", () => {
  let now = 0;
  const gate = new PaymentGate(
    { ...options, threshold: 1, maxInflight: 2, cooldownMs: 100 },
    () => now,
  );
  const old = gate.acquire();
  gate.acquire()(false);
  old(true);
  assert.throws(() => gate.acquire(), /temporarily unavailable/);
  now = 100;
  const probe = gate.acquire();
  assert.throws(() => gate.acquire(), /temporarily unavailable/);
  probe(false);
  assert.throws(() => gate.acquire(), /temporarily unavailable/);
  now = 200;
  gate.acquire()(true);
  const release = gate.acquire();
  release(true);
  release(false); // Double release cannot change state/capacity.
  gate.acquire()(true);
});

test("capacity has no waiting queue and is released even when breaker is disabled", () => {
  const gate = new PaymentGate({
    ...options,
    maxInflight: 1,
    circuitEnabled: false,
  });
  const release = gate.acquire();
  assert.throws(() => gate.acquire(), /capacity/);
  release(false);
  gate.acquire()(false);
});

test("healthy completions reset the consecutive failure threshold", () => {
  const gate = new PaymentGate({ ...options, threshold: 2 });
  gate.acquire()(false);
  gate.acquire()(true);
  gate.acquire()(false);
  gate.acquire()(true);
});

test("environment bounds reject invalid totals, capacity, thresholds, cooldowns and flags", () => {
  for (const env of [
    { PAYMENT_TOTAL_TIMEOUT_MS: "0" },
    { PAYMENT_TOTAL_TIMEOUT_MS: "25001" },
    { PAYMENT_MAX_INFLIGHT: "65" },
    { PAYMENT_MAX_INFLIGHT: "NaN" },
    { PAYMENT_CIRCUIT_FAILURE_THRESHOLD: "0" },
    { PAYMENT_CIRCUIT_COOLDOWN_MS: "99" },
    { PAYMENT_CIRCUIT_ENABLED: "yes" },
  ])
    assert.throws(() => readConfig(env));
  assert.equal(readConfig({}).paymentCircuitEnabled, true);
  assert.equal(
    readConfig({ PAYMENT_CIRCUIT_ENABLED: "false" }).paymentCircuitEnabled,
    false,
  );
});

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
const checkout = (base: string) =>
  fetch(base + "/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(order),
    signal: AbortSignal.timeout(3000),
  });

for (const stage of ["headers", "body"]) {
  test(
    `total deadline aborts hanging ${stage}, rejects excess concurrency and restores capacity`,
    { timeout: 8000 },
    async () => {
      let healthy = false;
      let calls = 0;
      let observed!: () => void;
      const arrived = new Promise<void>((resolve) => {
        observed = resolve;
      });
      // A real HTTP server is the stub; it deliberately never completes the fault.
      const stub = createServer((_request, response) => {
        calls++;
        if (healthy) {
          response.writeHead(201, { "content-type": "application/json" });
          response.end(JSON.stringify(result));
        } else if (stage === "body") {
          response.writeHead(201, { "content-type": "application/json" });
          response.write('{"unfinished":');
        }
        observed();
      });
      const paymentUrl = await listen(stub);
      const server = createServer(
        createApp(
          {
            paymentUrl,
            paymentTimeoutMs: 2000,
            paymentTotalTimeoutMs: 400,
            paymentMaxAttempts: 2,
            paymentMaxInflight: 1,
          },
          () => {},
        ),
      );
      const base = await listen(server);
      try {
        const begin = performance.now();
        const pending = checkout(base);
        await arrived;
        const rejected = await checkout(base);
        assert.equal(rejected.status, 503);
        assert.equal((await rejected.json()).error.code, "PAYMENT_BUSY");
        assert.equal((await fetch(base + "/health")).status, 200);
        const timedOut = await pending;
        assert.equal(timedOut.status, 504);
        assert.equal(
          (await timedOut.json()).error.code,
          "PAYMENT_BUDGET_EXHAUSTED",
        );
        assert.ok(
          performance.now() - begin < 2000,
          "total budget must beat the per-attempt timeout",
        );
        assert.equal(calls, 1, "no extra retry beyond total budget");
        healthy = true;
        assert.equal((await checkout(base)).status, 201);
      } finally {
        await close(server);
        await close(stub);
      }
    },
  );
}

test(
  "transient retry preserves idempotency key and breaker fails fast after complete failed operations",
  { timeout: 8000 },
  async () => {
    const keys: string[] = [];
    let recovering = true;
    const stub = createServer((request, response) => {
      keys.push(String(request.headers["idempotency-key"]));
      if (recovering && keys.length === 2) {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
      } else {
        response.writeHead(503, { "content-type": "application/json" });
        response.end("{}");
      }
    });
    const paymentUrl = await listen(stub);
    const server = createServer(
      createApp(
        {
          paymentUrl,
          paymentTimeoutMs: 500,
          paymentTotalTimeoutMs: 1500,
          paymentMaxAttempts: 2,
          paymentCircuitThreshold: 2,
        },
        () => {},
      ),
    );
    const base = await listen(server);
    try {
      assert.equal((await checkout(base)).status, 201);
      assert.deepEqual(keys, [order.order_id, order.order_id]);
      recovering = false;
      for (let i = 0; i < 2; i++)
        assert.equal((await checkout(base)).status, 502);
      assert.equal(keys.length, 6);
      const rejected = await checkout(base);
      assert.equal(rejected.status, 503);
      assert.equal((await rejected.json()).error.code, "PAYMENT_CIRCUIT_OPEN");
      assert.equal(
        keys.length,
        6,
        "open circuit must make zero downstream calls",
      );
      assert.equal((await fetch(base + "/health")).status, 200);
    } finally {
      await close(server);
      await close(stub);
    }
  },
);

test(
  "backoff consumes the same budget and business conflicts do not open the breaker",
  { timeout: 8000 },
  async () => {
    let calls = 0;
    let conflict = false;
    const stub = createServer((_request, response) => {
      calls++;
      setTimeout(
        () => {
          response.writeHead(conflict ? 409 : 503, {
            "content-type": "application/json",
          });
          response.end("{}");
        },
        conflict ? 0 : 70,
      );
    });
    const paymentUrl = await listen(stub);
    const server = createServer(
      createApp(
        {
          paymentUrl,
          paymentTimeoutMs: 1000,
          paymentTotalTimeoutMs: 100,
          paymentMaxAttempts: 2,
          paymentCircuitThreshold: 2,
        },
        () => {},
      ),
    );
    const base = await listen(server);
    try {
      const first = await checkout(base);
      assert.equal(first.status, 504);
      assert.equal((await first.json()).error.code, "PAYMENT_BUDGET_EXHAUSTED");
      assert.equal(calls, 1, "remaining budget cannot fit the retry backoff");
      conflict = true;
      for (let i = 0; i < 3; i++)
        assert.equal((await checkout(base)).status, 409);
      assert.equal(
        calls,
        4,
        "business conflicts are not retried or circuit failures",
      );
    } finally {
      await close(server);
      await close(stub);
    }
  },
);
