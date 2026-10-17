import assert from "node:assert/strict";
import { test } from "node:test";
import { validateKnowledge } from "../src/knowledge-context.js";
import { knowledgeFixture } from "./knowledge-fixture.js";

test("knowledge citations bind exact reviewed source, version, section, Unicode range and hashes", () => {
  const good = knowledgeFixture();
  assert.equal(
    validateKnowledge(good, "checkout-service", "dependency").status,
    "OK",
  );
  for (const patch of [
    { document_version: 999 },
    { document_id: "unknown" },
    { passage: "fabricated" },
    { section: "Checks" },
    { start_offset: 0 },
    { path: "../../.env" },
    { model_id: "different" },
    { similarity: 0.1 },
    { execute: "rollback" },
    { ordinal: 30 },
  ]) {
    assert.throws(() =>
      validateKnowledge(
        { ...good, citations: [{ ...good.citations[0], ...patch }] },
        "checkout-service",
        "dependency",
      ),
    );
  }
  assert.throws(() => validateKnowledge(good, "unknown-service", "dependency"));
  assert.throws(() => validateKnowledge(good, "checkout-service", "load"));
  assert.throws(() =>
    validateKnowledge({ ...good, execute: "rollback" }, "checkout-service"),
  );
  assert.throws(() =>
    validateKnowledge({ ...good, citations: [] }, "checkout-service"),
  );
  assert.equal(
    validateKnowledge(
      {
        version: 1,
        status: "UNAVAILABLE",
        policy: "UNTRUSTED_GUIDANCE_ONLY",
        citations: [],
      },
      "checkout-service",
    ).status,
    "UNAVAILABLE",
  );
});
