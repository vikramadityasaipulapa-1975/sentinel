import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

const payment = {
  order_id: "11111111-1111-4111-8111-111111111111",
  amount_minor: 12500,
  currency: "INR",
};
const result = { ...payment, payment_id: "22222222-2222-4222-8222-222222222222", status: "succeeded" };

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

for (const scenario of ["success", "unavailable", "timeout", "malformed", "wrong-order", "oversized"]) {
  test(`checkout handles ${scenario} payment`, { timeout: 5000 }, async () => {
    // This server is a test double, not the real FastAPI payment application.
    const stub = createServer((request, response) => {
      assert.equal(request.url, "/payments");
      assert.equal(request.method, "POST");
      if (scenario === "timeout") return;
      response.writeHead(201, { "content-type": "application/json" });
      response.end(scenario === "malformed" ? "not-json" : scenario === "oversized" ? "x".repeat(17000) :
        JSON.stringify(scenario === "wrong-order" ? { ...result, amount_minor: 1 } : result));
    });
    const paymentUrl = await listen(stub);
    if (scenario === "unavailable") await close(stub);
    const appServer = createServer(createApp({ paymentUrl, paymentTimeoutMs: scenario === "timeout" ? 150 : 1500 }));
    const baseUrl = await listen(appServer);
    try {
      const response = await fetch(`${baseUrl}/checkout`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(payment), signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, scenario === "success" ? 201 : scenario === "timeout" ? 504 : 502);
      const body = await response.json();
      if (scenario === "success") assert.deepEqual(body, result);
      else assert.match(body.error.code, /^PAYMENT_/);
    } finally {
      await close(appServer);
      if (stub.listening) await close(stub);
    }
  });
}

test("checkout rejects invalid input and unsupported media", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/checkout`;
    for (const body of [{}, { ...payment, amount_minor: true }, { ...payment, secret: "fake" }]) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 422);
      await response.body?.cancel();
    }
    const response = await fetch(url, { method: "POST", body: "text", signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 415);
    await response.body?.cancel();
  } finally {
    await close(server);
  }
});

test("configuration rejects external payment URL and unbounded timeout", () => {
  assert.throws(() => readConfig({ PAYMENT_URL: "http://example.com" }));
  assert.throws(() => readConfig({ PAYMENT_TIMEOUT_MS: "0" }));
  assert.throws(() => readConfig({ PAYMENT_TIMEOUT_MS: "NaN" }));
});
