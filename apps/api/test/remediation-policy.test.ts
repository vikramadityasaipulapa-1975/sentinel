import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTION,
  SANDBOX,
  dryRun,
  parseProposal,
} from "../src/remediation-policy.js";
export const binding = {
  project: SANDBOX,
  container_id: "a".repeat(64),
  current_image: "sha256:" + "b".repeat(64),
  current_version: "payment-v3-error",
  target_image: "sha256:" + "c".repeat(64),
  target_version: "payment-v1",
};
test("sandbox dry run is bounded and cannot select commands, versions or services", () => {
  assert.equal(
    dryRun("payment-service", "OPEN", binding).execution_performed,
    false,
  );
  for (const changed of [
    { project: "sentinel-demo" },
    { target_version: "latest" },
    { target_image: "evil;sh" },
    { current_image: binding.target_image },
    { container_id: "other" },
  ])
    assert.throws(() =>
      dryRun("payment-service", "OPEN", { ...binding, ...changed }),
    );
  assert.throws(() => dryRun("checkout-service", "OPEN", binding));
  assert.throws(() => dryRun("payment-service", "CLOSED", binding));
  const proposal = {
    action: ACTION,
    incident_id: "11111111-1111-4111-8111-111111111111",
    idempotency_key: "22222222-2222-4222-8222-222222222222",
  };
  assert.equal(parseProposal(proposal).action, ACTION);
  for (const patch of [
    { action: "EXECUTE_SHELL" },
    { command: "rollback" },
    { target_image: "latest" },
    { url: "http://metadata" },
  ])
    assert.throws(() => parseProposal({ ...proposal, ...patch }));
});
