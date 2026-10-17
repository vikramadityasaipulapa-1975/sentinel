import assert from "node:assert/strict";
import { test } from "node:test";
import { validateReport } from "../src/investigation-report.js";
import { reportFixture } from "./report-fixture.js";

test("report citations must match exact source, pointer, measurement and eligible category", () => {
  const { report, evidence } = reportFixture();
  assert.equal(validateReport(report, evidence).ai_performed, false);
  assert.throws(() =>
    validateReport(
      { ...report, facts: [{ ...report.facts[0], value: 0.7 }] },
      evidence,
    ),
  );
  assert.throws(() =>
    validateReport(
      { ...report, facts: [{ ...report.facts[0], id: "invented.value" }] },
      evidence,
    ),
  );
  assert.throws(() =>
    validateReport(
      {
        ...report,
        hypotheses: [{ ...report.hypotheses[0], category: "deployment" }],
      },
      evidence,
    ),
  );
  assert.throws(() =>
    validateReport({ ...report, execute: "anything" }, evidence),
  );
});
