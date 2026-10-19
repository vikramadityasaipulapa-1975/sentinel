import { record, text } from "./client";
export type TimelineEvent = {
  id: string;
  incident_id: string;
  sequence: string;
  type: string;
  payload: Record<string, unknown>;
  occurred_at: string;
};
export type Frame = { event: string; id?: string; data: string };
export function frames(buffer: string) {
  const complete: Frame[] = [];
  let remaining = buffer.replace(/\r\n/g, "\n"),
    boundary: number;
  while ((boundary = remaining.indexOf("\n\n")) >= 0) {
    const block = remaining.slice(0, boundary);
    remaining = remaining.slice(boundary + 2);
    let event = "message",
      id: string | undefined;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const split = line.indexOf(":");
      const key = split < 0 ? line : line.slice(0, split);
      const value = split < 0 ? "" : line.slice(split + 1).replace(/^ /, "");
      if (key === "event") event = value;
      if (key === "id") id = value;
      if (key === "data") data.push(value);
    }
    if (data.length) complete.push({ event, id, data: data.join("\n") });
  }
  if (remaining.length > 131072)
    throw new Error("Progress event exceeds safe size");
  return { complete, remaining };
}
export function timelineEvent(
  value: unknown,
  incidentId: string,
): TimelineEvent {
  const row = record(value),
    sequence = text(row.sequence);
  if (
    row.incident_id !== incidentId ||
    !/^[1-9]\d{0,18}$/.test(sequence) ||
    !["CREATED", "STATUS_CHANGED", "INVESTIGATION", "REMEDIATION"].includes(
      text(row.type),
    )
  )
    throw new Error("Invalid progress event");
  return {
    id: text(row.id),
    incident_id: incidentId,
    sequence,
    type: text(row.type),
    payload: record(row.payload),
    occurred_at: text(row.occurred_at),
  };
}
export function mergeEvents(old: TimelineEvent[], incoming: TimelineEvent) {
  const map = new Map(old.map((event) => [event.id, event]));
  map.set(incoming.id, incoming);
  return [...map.values()]
    .sort((a, b) =>
      BigInt(a.sequence) < BigInt(b.sequence)
        ? -1
        : BigInt(a.sequence) > BigInt(b.sequence)
          ? 1
          : 0,
    )
    .slice(-100);
}
