import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createApp } from "../src/app.js";
test("built dashboard serves deep links with CSP and preserves API and missing-asset boundaries", async () => {
  assert.ok(
    existsSync(
      fileURLToPath(new URL("../../../web/dist/index.html", import.meta.url)),
    ),
    "Build apps/web before running this dashboard integration check",
  );
  const server = createApp(
    { ready: async () => true, list: async () => [] },
    () => {},
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(base + "/dashboard/incidents/example");
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-security-policy")!,
      /script-src 'self'/,
    );
    const html = await response.text();
    assert.match(html, /id="root"/);
    const asset = /src="(\/dashboard\/assets\/[^"]+\.js)"/.exec(html);
    assert.ok(asset);
    assert.equal((await fetch(base + asset[1])).status, 200);
    assert.equal(
      (await fetch(base + "/dashboard/assets/missing.js")).status,
      404,
    );
    assert.notEqual(
      (await fetch(base + "/api/v1/unknown")).headers.get("content-type"),
      "text/html; charset=utf-8",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
