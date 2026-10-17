import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { createApp } from "../src/app.js";

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
function sample(text: string, name: string, labels: Record<string, string>) {
  for (const line of text.split("\n")) {
    if (!line.startsWith(name + "{")) continue;
    const values = Object.fromEntries(
      [...line.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    if (Object.entries(labels).every(([key, value]) => values[key] === value))
      return Number(line.slice(line.lastIndexOf(" ") + 1));
  }
  assert.fail(`Missing ${name} sample`);
}
test(
  "checkout metrics count real HTTP success/failure once, include dependency latency and bound labels",
  { timeout: 10000 },
  async () => {
    // Only the payment dependency is a stub; Express and the metrics endpoint are real.
    const stub = createServer((_request, response) =>
      setTimeout(() => {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            order_id: "11111111-1111-4111-8111-111111111111",
            payment_id: "22222222-2222-4222-8222-222222222222",
            amount_minor: 12500,
            currency: "INR",
            status: "succeeded",
          }),
        );
      }, 80),
    );
    const paymentUrl = await listen(stub);
    const server = createServer(
      createApp(
        { paymentUrl, paymentTimeoutMs: 1500, paymentMaxAttempts: 1 },
        () => {},
      ),
    );
    const base = await listen(server);
    try {
      assert.equal(
        (
          await fetch(base + "/checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              order_id: "11111111-1111-4111-8111-111111111111",
              amount_minor: 12500,
              currency: "INR",
            }),
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await fetch(base + "/checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
        ).status,
        422,
      );
      assert.equal(
        (
          await fetch(base + "/checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{",
          })
        ).status,
        400,
      );
      for (const value of ["private-id-a", "private-id-b"])
        await fetch(base + "/missing/" + value + "?token=never-label-this");
      const response = await fetch(base + "/metrics");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type")!, /text\/plain/);
      const text = await response.text();
      const good = {
        service: "checkout-service",
        method: "POST",
        route: "/checkout",
        status_code: "201",
      };
      assert.equal(sample(text, "sentinel_http_requests_total", good), 1);
      assert.equal(
        sample(text, "sentinel_http_request_duration_seconds_count", good),
        1,
      );
      assert.ok(
        sample(text, "sentinel_http_request_duration_seconds_sum", good) >=
          0.06,
      );
      assert.equal(
        sample(text, "sentinel_http_request_duration_seconds_bucket", {
          ...good,
          le: "+Inf",
        }),
        1,
      );
      assert.equal(
        sample(text, "sentinel_http_requests_total", {
          route: "/checkout",
          status_code: "422",
        }),
        1,
      );
      assert.equal(
        sample(text, "sentinel_http_requests_total", {
          route: "unmatched",
          status_code: "400",
        }),
        1,
      );
      assert.equal(
        sample(text, "sentinel_http_requests_total", {
          route: "unmatched",
          status_code: "404",
        }),
        2,
      );
      assert.doesNotMatch(
        text,
        /private-id|never-label-this|request_id|order_id/,
      );
      assert.equal(await (await fetch(base + "/metrics")).text(), text);
    } finally {
      await close(server);
      await close(stub);
    }
  },
);
test("checkout metrics registries are isolated for each app", async () => {
  const a = createServer(createApp(undefined, () => {})),
    b = createServer(createApp(undefined, () => {}));
  const one = await listen(a),
    two = await listen(b);
  try {
    await fetch(one + "/health");
    assert.match(
      await (await fetch(one + "/metrics")).text(),
      /route="\/health"/,
    );
    assert.doesNotMatch(
      await (await fetch(two + "/metrics")).text(),
      /route="\/health"/,
    );
  } finally {
    await close(a);
    await close(b);
  }
});
