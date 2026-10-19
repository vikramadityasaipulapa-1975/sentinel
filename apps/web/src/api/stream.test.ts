import { expect, test } from "vitest";
import { frames, mergeEvents, timelineEvent } from "./stream";
const row = {
  id: "e",
  incident_id: "i",
  sequence: "10",
  type: "INVESTIGATION",
  payload: { event: "PARTIAL" },
  occurred_at: "2026-10-19T00:00:00Z",
};
test("SSE preserves split frames, comments, CRLF and multi-line data", () => {
  const first = frames(
    ": heartbeat\r\n\r\nid: c\r\nevent: incident_event\r\ndata: {\r\n",
  );
  expect(first.complete).toEqual([]);
  const next = frames(first.remaining + 'data: "x":1}\r\n\r\n');
  expect(next.complete).toEqual([
    { id: "c", event: "incident_event", data: '{\n"x":1}' },
  ]);
});
test("timeline accepts PARTIAL, deduplicates replay and sorts large sequences exactly", () => {
  const event = timelineEvent(row, "i");
  expect(mergeEvents([event], event)).toHaveLength(1);
  expect(
    mergeEvents([event], {
      ...event,
      id: "next",
      sequence: "9007199254740993",
    })[1].id,
  ).toBe("next");
});
test("wrong incident, invalid sequence and oversized buffers are rejected", () => {
  expect(() => timelineEvent(row, "other")).toThrow();
  expect(() => timelineEvent({ ...row, sequence: "-1" }, "i")).toThrow();
  expect(() => frames("x".repeat(131073))).toThrow();
});
