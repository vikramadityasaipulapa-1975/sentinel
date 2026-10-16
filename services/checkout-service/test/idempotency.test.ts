import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";

for (const transient of [true, false]) {
  test(
    transient
      ? "transient payment retries once with the identical key"
      : "payment conflict is not retried",
    { timeout: 5000 },
    async () => {
      const keys: string[] = [];
      const request = {
        order_id: "11111111-1111-4111-8111-111111111111",
        amount_minor: 1,
        currency: "INR",
      };
      const key = "33333333-3333-4333-8333-333333333333";
      const stub = createServer((incoming, response) => {
        keys.push(String(incoming.headers["idempotency-key"]));
        response.writeHead(
          transient && keys.length === 2 ? 201 : transient ? 503 : 409,
          { "content-type": "application/json" },
        );
        response.end(
          JSON.stringify({
            ...request,
            payment_id: "22222222-2222-4222-8222-222222222222",
            status: "succeeded",
          }),
        );
      }).listen(0, "127.0.0.1");
      await once(stub, "listening");
      const stubAddress = stub.address();
      assert.ok(stubAddress && typeof stubAddress !== "string");
      const server = createApp(
        {
          paymentUrl: `http://127.0.0.1:${stubAddress.port}`,
          paymentTimeoutMs: 1000,
          paymentMaxAttempts: 2,
        },
        () => {},
      ).listen(0, "127.0.0.1");
      try {
        await once(server, "listening");
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const response = await fetch(
          `http://127.0.0.1:${address.port}/checkout`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": key,
            },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(3000),
          },
        );
        assert.equal(response.status, transient ? 201 : 409);
        await response.body?.cancel();
        assert.deepEqual(keys, transient ? [key, key] : [key]);
      } finally {
        for (const listener of [server, stub]) {
          await new Promise<void>((resolve, reject) => {
            listener.close((error) => (error ? reject(error) : resolve()));
            listener.closeAllConnections();
          });
        }
      }
    },
  );
}
