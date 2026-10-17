import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonical,
  hash,
  readSnapshot,
  validateEvidence,
  evidenceConfig,
} from "../src/evidence.js";

test("canonical evidence hash ignores object key order but detects modified data", () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  const text = canonical({ a: 1 });
  assert.equal(
    readSnapshot({
      canonical_json: text,
      payload_json: { a: 1 },
      sha256: hash(text),
    }).hash_verified,
    true,
  );
  assert.throws(() =>
    readSnapshot({
      canonical_json: text,
      payload_json: { a: 2 },
      sha256: hash(text),
    }),
  );
  assert.throws(() => canonical({ x: Infinity }));
});
test("collector configuration and evidence contracts reject unsafe inputs", () => {
  assert.equal(evidenceConfig({}), null);
  assert.throws(() =>
    evidenceConfig({
      SENTINEL_EVIDENCE_URL: "http://remote",
      SENTINEL_EVIDENCE_SECRET: "a".repeat(64),
    }),
  );
  assert.throws(() => validateEvidence([]));
  assert.throws(() => canonical(JSON.parse('{"__proto__":{"x":1}}')));
});
