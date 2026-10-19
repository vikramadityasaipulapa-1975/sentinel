import { expect, test } from "vitest";
import { chartPaths, numericSeries, snapshots } from "./evidence";
test("chart data preserves zero, sorts numeric samples and separates missing intervals", () => {
  const points = numericSeries([
    [45, 2],
    [0, 0],
    [15, 1],
    [20, null],
    [30, NaN],
  ]);
  expect(points).toEqual([
    [0, 0],
    [15, 1],
    [45, 2],
  ]);
  const paths = chartPaths(points, 0, 60, 15);
  expect(paths).toHaveLength(2);
  expect(paths[0]).toContain(" L");
  expect(paths[1]).toMatch(/^M/);
  expect(numericSeries(undefined)).toEqual([]);
});
test("unverified evidence is rejected instead of displayed as trusted", () => {
  expect(() =>
    snapshots({
      snapshots: [{ hash_verified: false, evidence: { window: {} } }],
      next_cursor: null,
    }),
  ).toThrow("integrity");
});
