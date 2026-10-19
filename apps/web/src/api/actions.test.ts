import { expect, test } from "vitest";
import { action, canDecide, fingerprint } from "./actions";
const fixture = {
  id: "a",
  incident_id: "i",
  action: "ROLLBACK_SANDBOX_PAYMENT",
  status: "PENDING",
  created_at: "2026-10-19T00:00:00Z",
  expires_at: "2026-10-19T00:10:00Z",
  requested_by: "u",
  decided_by: null,
  binding_json: {
    project: "sentinel-remediation-sandbox",
    container_id: "a".repeat(64),
    current_image: "sha256:" + "b".repeat(64),
    current_version: "payment-v3-error",
    target_image: "sha256:" + "c".repeat(64),
    target_version: "payment-v1",
  },
  events: [],
  result_json: null,
};
test("only ADMIN with exact reviewed pending unexpired binding can decide", () => {
  const value = action(fixture, "i"),
    review = fingerprint(value),
    now = Date.parse("2026-10-19T00:05:00Z");
  expect(canDecide(value, "ADMIN", review, now)).toBe(true);
  for (const role of ["VIEWER", "OPERATOR"])
    expect(canDecide(value, role, review, now)).toBe(false);
  expect(canDecide(value, "ADMIN", review, Date.parse(value.expires_at))).toBe(
    false,
  );
  expect(
    canDecide(
      {
        ...value,
        binding: { ...value.binding, target_image: "sha256:" + "d".repeat(64) },
      },
      "ADMIN",
      review,
      now,
    ),
  ).toBe(false);
  expect(
    canDecide({ ...value, status: "APPROVED" }, "ADMIN", review, now),
  ).toBe(false);
});
test("cross-incident and non-sandbox action data is rejected", () => {
  expect(() => action(fixture, "other")).toThrow();
  expect(() =>
    action(
      {
        ...fixture,
        binding_json: { ...fixture.binding_json, project: "production" },
      },
      "i",
    ),
  ).toThrow();
});
