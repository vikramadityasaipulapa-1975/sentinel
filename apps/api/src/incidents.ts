import { uuidPattern } from "./services.js";

export const statuses = [
  "OPEN",
  "INVESTIGATING",
  "MITIGATING",
  "RESOLVED",
  "CLOSED",
] as const;
export type IncidentStatus = (typeof statuses)[number];
export const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof severities)[number];
export interface CreateIncident {
  service_id: string;
  title: string;
  severity: Severity;
}
export interface Incident extends CreateIncident {
  id: string;
  status: IncidentStatus;
  started_at: string;
  resolved_at: string | null;
  created_at: string;
}
export interface IncidentEvent {
  id: string;
  incident_id: string;
  sequence: string;
  type: "CREATED" | "STATUS_CHANGED";
  payload: Record<string, string>;
  occurred_at: string;
  created_at: string;
}
export interface IncidentPage {
  incidents: Incident[];
  next_cursor: string | null;
}
export interface EventPage {
  events: IncidentEvent[];
  next_cursor: string | null;
}
export interface ListOptions {
  limit: number;
  position?: string;
  status?: IncidentStatus;
  service_id?: string;
}
export interface IncidentStore {
  ready(): Promise<boolean>;
  create(input: CreateIncident): Promise<Incident>;
  list(options: ListOptions): Promise<IncidentPage>;
  get(id: string): Promise<Incident>;
  transition(id: string, status: IncidentStatus): Promise<Incident>;
  events(id: string, options: ListOptions): Promise<EventPage>;
}
export class IncidentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const invalid = (message = "Invalid incident fields") =>
  new IncidentError(422, "INVALID_INCIDENT", message);
export const notFound = () =>
  new IncidentError(404, "INCIDENT_NOT_FOUND", "Incident not found");
export const unavailable = () =>
  new IncidentError(
    503,
    "DATABASE_UNAVAILABLE",
    "Incident storage unavailable",
  );

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}
export function parseId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw invalid("ID must be a UUID");
  return value.toLowerCase();
}
export function parseCreate(value: unknown): CreateIncident {
  const input = object(value);
  if (
    Object.keys(input).length !== 3 ||
    !Object.keys(input).every((key) =>
      ["service_id", "title", "severity"].includes(key),
    ) ||
    typeof input.title !== "string" ||
    input.title.trim().length < 1 ||
    input.title.trim().length > 200 ||
    /[\u0000-\u001f\u007f]/.test(input.title) ||
    !severities.includes(input.severity as Severity)
  )
    throw invalid();
  return {
    service_id: parseId(input.service_id),
    title: input.title.trim(),
    severity: input.severity as Severity,
  };
}
export function parseTransition(value: unknown): IncidentStatus {
  const input = object(value);
  if (
    Object.keys(input).length !== 1 ||
    !statuses.includes(input.status as IncidentStatus)
  )
    throw invalid("Provide only a valid status");
  return input.status as IncidentStatus;
}
const transitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  OPEN: ["INVESTIGATING"],
  INVESTIGATING: ["MITIGATING", "RESOLVED"],
  MITIGATING: ["INVESTIGATING", "RESOLVED"],
  RESOLVED: ["INVESTIGATING", "CLOSED"],
  CLOSED: [],
};
export function assertTransition(from: IncidentStatus, to: IncidentStatus) {
  if (from !== to && !transitions[from].includes(to))
    throw new IncidentError(
      409,
      "INVALID_STATUS_TRANSITION",
      "Status transition is not allowed",
    );
}

function isPosition(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  );
}
export const listScope = (
  options: Pick<ListOptions, "status" | "service_id">,
) => `incidents|${options.status ?? ""}|${options.service_id ?? ""}`;
export const eventScope = (id: string) => `events|${id}`;
export function encodeCursor(position: string, scope: string): string {
  if (!isPosition(position)) throw new Error("Invalid database position");
  return Buffer.from(JSON.stringify({ v: 1, position, scope })).toString(
    "base64url",
  );
}
function decodeCursor(value: unknown, scope: string): string {
  try {
    if (
      typeof value !== "string" ||
      value.length > 512 ||
      !/^[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const buffer = Buffer.from(value, "base64url");
    if (buffer.toString("base64url") !== value) throw new Error();
    const parsed = JSON.parse(buffer.toString("utf8"));
    if (
      !parsed ||
      Object.keys(parsed).length !== 3 ||
      parsed.v !== 1 ||
      parsed.scope !== scope ||
      !isPosition(parsed.position)
    )
      throw new Error();
    return parsed.position;
  } catch {
    throw new IncidentError(
      400,
      "INVALID_CURSOR",
      "Invalid cursor for this query",
    );
  }
}
export function parseList(query: unknown, incidentId?: string): ListOptions {
  const input = object(query);
  const allowed = incidentId
    ? ["limit", "cursor"]
    : ["limit", "cursor", "status", "service_id"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw invalid("Unknown query field");
  const raw = input.limit ?? "20";
  if (
    typeof raw !== "string" ||
    !/^[1-9]\d{0,2}$/.test(raw) ||
    Number(raw) > 100
  )
    throw invalid("Limit must be 1-100");
  const result: ListOptions = { limit: Number(raw) };
  if (input.status !== undefined) {
    if (!statuses.includes(input.status as IncidentStatus))
      throw invalid("Invalid status filter");
    result.status = input.status as IncidentStatus;
  }
  if (input.service_id !== undefined)
    result.service_id = parseId(input.service_id);
  if (input.cursor !== undefined)
    result.position = decodeCursor(
      input.cursor,
      incidentId ? eventScope(incidentId) : listScope(result),
    );
  return result;
}

function timestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error("Invalid stored timestamp");
  return value.toISOString();
}
export function readIncident(row: Record<string, unknown>): Incident {
  if (
    typeof row.id !== "string" ||
    !uuidPattern.test(row.id) ||
    typeof row.service_id !== "string" ||
    !uuidPattern.test(row.service_id) ||
    typeof row.title !== "string" ||
    row.title.trim().length < 1 ||
    row.title.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(row.title) ||
    !severities.includes(row.severity as Severity) ||
    !statuses.includes(row.status as IncidentStatus) ||
    ["RESOLVED", "CLOSED"].includes(row.status as string) !==
      (row.resolved_at !== null)
  )
    throw new Error("Invalid stored incident");
  return {
    id: row.id,
    service_id: row.service_id,
    title: row.title,
    severity: row.severity as Severity,
    status: row.status as IncidentStatus,
    started_at: timestamp(row.started_at),
    resolved_at: row.resolved_at === null ? null : timestamp(row.resolved_at),
    created_at: timestamp(row.created_at),
  };
}
export function readEvent(row: Record<string, unknown>): IncidentEvent {
  const payload = row.payload_json as Record<string, unknown> | null;
  const created =
    row.type === "CREATED" &&
    payload &&
    Object.keys(payload).length === 1 &&
    payload.status === "OPEN";
  const changed =
    row.type === "STATUS_CHANGED" &&
    payload &&
    Object.keys(payload).length === 2 &&
    statuses.includes(payload.from_status as IncidentStatus) &&
    statuses.includes(payload.to_status as IncidentStatus) &&
    payload.from_status !== payload.to_status;
  if (
    typeof row.id !== "string" ||
    !uuidPattern.test(row.id) ||
    typeof row.incident_id !== "string" ||
    !uuidPattern.test(row.incident_id) ||
    !isPosition(row.sequence) ||
    (!created && !changed)
  )
    throw new Error("Invalid stored incident event");
  return {
    id: row.id,
    incident_id: row.incident_id,
    sequence: row.sequence,
    type: row.type as IncidentEvent["type"],
    payload: payload as Record<string, string>,
    occurred_at: timestamp(row.occurred_at),
    created_at: timestamp(row.created_at),
  };
}
