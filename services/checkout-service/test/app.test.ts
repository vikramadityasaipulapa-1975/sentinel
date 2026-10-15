import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";

let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});

test(
  "GET /health returns the checkout health contract",
  { timeout: 5000 },
  async () => {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/,
    );
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "checkout-service",
    });
  },
);

for (const [method, path] of [
  ["GET", "/unknown"],
  ["POST", "/health"],
]) {
  test(`${method} ${path} returns JSON 404`, { timeout: 5000 }, async () => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(response.status, 404);
    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/json/,
    );
    const body = await response.json();
    assert.equal(body.request_id, response.headers.get("x-request-id"));
    assert.deepEqual(body.error, {
      code: "NOT_FOUND",
      message: "Route not found",
    });
  });
}
