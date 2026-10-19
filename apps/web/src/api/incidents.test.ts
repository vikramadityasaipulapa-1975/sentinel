import { expect, test } from "vitest";
import { incidentPage, transitions } from "./incidents";
test("incident readers preserve confirmed status and pagination", () => {
  const page = incidentPage({
    incidents: [
      {
        id: "i",
        service_id: "s",
        title: "Observed errors",
        status: "OPEN",
        severity: "HIGH",
        started_at: "2026-10-19T00:00:00Z",
        created_at: "2026-10-19T00:00:00Z",
        resolved_at: null,
      },
    ],
    next_cursor: "cursor",
  });
  expect(page.next).toBe("cursor");
  expect(page.incidents[0].status).toBe("OPEN");
  expect(transitions.OPEN).toEqual(["INVESTIGATING"]);
  expect(transitions.CLOSED).toEqual([]);
});
test("unknown incident state and malformed pages are rejected", () => {
  expect(() =>
    incidentPage({
      incidents: [{ status: "HEALTHY", severity: "HIGH" }],
      next_cursor: null,
    }),
  ).toThrow();
  expect(() => incidentPage({ incidents: {}, next_cursor: null })).toThrow();
});
