import assert from "node:assert/strict";
import { test } from "node:test";
import { tracing, traceHeaders } from "../src/tracing.js";

test("tracing is optional and rejects untrusted export destinations", () => {
  const old = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  try {
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    assert.equal(tracing().provider, undefined);
    assert.deepEqual(traceHeaders(), {});
    for (const endpoint of [
      "http://example.com/v1/traces",
      "http://user:password@localhost:4418/v1/traces",
      "http://localhost:4418/v1/traces?secret=bad",
    ]) {
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = endpoint;
      assert.throws(tracing, /fixed local/);
    }
  } finally {
    if (old === undefined)
      delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = old;
  }
});
