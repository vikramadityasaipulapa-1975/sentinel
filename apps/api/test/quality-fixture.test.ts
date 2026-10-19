import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("quality fixture refuses main databases and mismatched owned directories before connecting", async () => {
  for (const database of [
    "sentinel_api",
    "sentinel_p10_quality_aaaaaaaaaaaa",
  ]) {
    await assert.rejects(
      promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL("./quality-fixture.js", import.meta.url))],
        {
          env: {
            ...process.env,
            SENTINEL_DATABASE_URL: `postgresql://fixture:fake@127.0.0.1:1/${database}`,
            SENTINEL_DATABASE_TLS: "disable",
            SENTINEL_API_PORT: "39999",
            SENTINEL_QUALITY_DIRECTORY: "intentionally-not-an-owned-directory",
          },
          timeout: 10000,
        },
      ),
      (error: unknown) => {
        const failure = error as Error & { stderr: string };
        assert.match(
          failure.stderr,
          /Owned disposable P10 database and directory required/,
        );
        assert.doesNotMatch(failure.stderr, /ECONNREFUSED/);
        return true;
      },
    );
  }
});
