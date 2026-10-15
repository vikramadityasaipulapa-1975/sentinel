import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { uuidPattern } from "../src/contracts.js";
import type { LogRecord } from "../src/http.js";

test(
  "request IDs, bounded errors, and logs omit sensitive input",
  { timeout: 10000 },
  async () => {
    const records: LogRecord[] = [];
    const server = createApp(readConfig(), (record) =>
      records.push(record),
    ).listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}`;
      const id = "33333333-3333-4333-8333-333333333333";
      const health = await fetch(`${url}/health?token=secret-marker`, {
        headers: { "x-request-id": id, authorization: "secret-marker" },
        signal: AbortSignal.timeout(2000),
      });
      assert.equal(health.headers.get("x-request-id"), id);
      await health.body?.cancel();
      for (const [body, expected] of [
        ["{secret-marker", 400],
        [JSON.stringify({ secret: "secret-marker" }), 422],
        [JSON.stringify({ secret: "secret-marker".repeat(1000) }), 413],
      ] as const) {
        const response = await fetch(`${url}/checkout`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": "secret-marker",
          },
          body,
          signal: AbortSignal.timeout(2000),
        });
        assert.equal(response.status, expected);
        const result = await response.json();
        assert.match(result.request_id, uuidPattern);
        assert.equal(result.request_id, response.headers.get("x-request-id"));
        assert.ok(!JSON.stringify(result).includes("secret-marker"));
      }
      assert.equal(records.length, 4);
      assert.equal(records[0].request_id, id);
      assert.ok(
        records.every(
          (record) =>
            record.duration_ms >= 0 &&
            !Number.isNaN(Date.parse(record.timestamp)),
        ),
      );
      assert.ok(!JSON.stringify(records).includes("secret-marker"));
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  },
);
