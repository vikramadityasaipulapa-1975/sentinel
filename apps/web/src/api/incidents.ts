import { array, record, text } from "./client";
export const statuses = [
  "OPEN",
  "INVESTIGATING",
  "MITIGATING",
  "RESOLVED",
  "CLOSED",
] as const;
export const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Incident = {
  id: string;
  service_id: string;
  title: string;
  status: (typeof statuses)[number];
  severity: (typeof severities)[number];
  started_at: string;
  resolved_at: string | null;
  created_at: string;
};
export function incident(value: unknown): Incident {
  const r = record(value);
  if (
    !statuses.includes(r.status as Incident["status"]) ||
    !severities.includes(r.severity as Incident["severity"])
  )
    throw new Error("Invalid incident status or severity");
  return {
    id: text(r.id),
    service_id: text(r.service_id),
    title: text(r.title),
    status: r.status as Incident["status"],
    severity: r.severity as Incident["severity"],
    started_at: text(r.started_at),
    created_at: text(r.created_at),
    resolved_at: r.resolved_at === null ? null : text(r.resolved_at),
  };
}
export function incidentPage(value: unknown) {
  const r = record(value);
  return {
    incidents: array(r.incidents).map(incident),
    next: r.next_cursor === null ? null : text(r.next_cursor),
  };
}
export const transitions: Record<Incident["status"], Incident["status"][]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["MITIGATING", "RESOLVED"],
  MITIGATING: ["INVESTIGATING", "RESOLVED"],
  RESOLVED: ["INVESTIGATING", "CLOSED"],
  CLOSED: [],
};
