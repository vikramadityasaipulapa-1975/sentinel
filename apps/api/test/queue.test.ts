import assert from "node:assert/strict";
import { test } from "node:test";
import { readRedisUrl, readWorkDelay } from "../src/investigation-queue.js";
test("queue configuration requires credentials, bounded workflow delay and TLS for hosted Redis", () => {
  assert.ok(
    readRedisUrl({
      SENTINEL_REDIS_URL:
        "rediss://default:fake-password@redis.example.com:6379/0",
    }).startsWith("rediss:"),
  );
  assert.ok(
    readRedisUrl({
      SENTINEL_REDIS_URL: "redis://default:fake-password@127.0.0.1:56379/0",
    }),
  );
  for (const value of [
    undefined,
    "redis://127.0.0.1/0",
    "redis://default:fake@redis.example.com/0",
    "redis://default:fake@localhost/0?tls=false",
  ])
    assert.throws(() => readRedisUrl({ SENTINEL_REDIS_URL: value }));
  assert.equal(readWorkDelay({}), 300);
  assert.throws(() => readWorkDelay({ SENTINEL_WORK_CHECK_DELAY_MS: "5001" }));
});
