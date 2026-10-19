import { array, record, text } from "./client";
export type Run = {
  id: string;
  status: string;
  attempts: number;
  created_at: string;
  finished_at: string | null;
};
export function runs(value: unknown) {
  const r = record(value);
  return {
    items: array(r.investigations).map((value) => {
      const row = record(value);
      if (typeof row.attempts !== "number")
        throw new Error("Invalid investigation attempts");
      return {
        id: text(row.id),
        status: text(row.status),
        attempts: row.attempts,
        created_at: text(row.created_at),
        finished_at: row.finished_at === null ? null : text(row.finished_at),
      };
    }),
    next: r.next_cursor === null ? null : text(r.next_cursor),
  };
}
export type Snapshot = {
  id: string;
  source: string;
  hash: string;
  verified: boolean;
  status: string;
  collected: string;
  window: { start: string; end: string; service: string };
  data: Record<string, unknown>;
  locator: Record<string, unknown>;
};
export function snapshots(value: unknown) {
  const row = record(value);
  return {
    items: array(row.snapshots).map((value) => {
      const r = record(value),
        e = record(r.evidence),
        w = record(e.window);
      if (r.hash_verified !== true)
        throw new Error("Evidence integrity was not verified by the server");
      return {
        id: text(r.id),
        source: text(r.source),
        hash: text(r.sha256),
        verified: true,
        status: text(e.status),
        collected: text(e.collected_at),
        window: {
          start: text(w.start),
          end: text(w.end),
          service: text(w.service),
        },
        data: record(e.data),
        locator: record(e.locator),
      };
    }),
    next: row.next_cursor === null ? null : text(row.next_cursor),
  };
}
export type Point = [number, number];
export function numericSeries(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (p): p is Point =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((x) => typeof x === "number" && Number.isFinite(x)),
    )
    .slice(0, 600)
    .sort((a, b) => a[0] - b[0]);
}
export function chartPaths(
  points: Point[],
  start: number,
  end: number,
  step: number,
) {
  const max = Math.max(...points.map((p) => p[1]), 1);
  const groups: string[] = [];
  let last: number | undefined;
  for (const [stamp, value] of points) {
    if (stamp < start || stamp > end) continue;
    const xy = `${20 + ((stamp - start) / Math.max(end - start, 1)) * 560},${115 - (value / max) * 95}`;
    if (last === undefined || stamp - last > step * 1.5) groups.push(`M${xy}`);
    else groups[groups.length - 1] += ` L${xy}`;
    last = stamp;
  }
  return groups;
}
