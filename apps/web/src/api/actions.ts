import { array, record, text } from "./client";
export type Binding = {
  project: string;
  container_id: string;
  current_image: string;
  current_version: string;
  target_image: string;
  target_version: string;
};
export type Action = {
  id: string;
  incident_id: string;
  action: string;
  status: string;
  expires_at: string;
  created_at: string;
  requested_by: string;
  decided_by: string | null;
  binding: Binding;
  events: Record<string, unknown>[];
  result: unknown;
};
export function binding(value: unknown): Binding {
  const r = record(value);
  if (
    r.project !== "sentinel-remediation-sandbox" ||
    r.target_version !== "payment-v1" ||
    !["payment-v2-timeout", "payment-v3-error"].includes(
      text(r.current_version),
    )
  )
    throw new Error("Unrecognized sandbox binding");
  for (const key of ["current_image", "target_image"])
    if (!/^sha256:[a-f0-9]{64}$/.test(text(r[key])))
      throw new Error("Invalid immutable image");
  if (!/^[a-f0-9]{64}$/.test(text(r.container_id)))
    throw new Error("Invalid container binding");
  return {
    project: text(r.project),
    container_id: text(r.container_id),
    current_image: text(r.current_image),
    current_version: text(r.current_version),
    target_image: text(r.target_image),
    target_version: text(r.target_version),
  };
}
export function action(value: unknown, incidentId: string): Action {
  const r = record(value);
  if (
    r.incident_id !== incidentId ||
    r.action !== "ROLLBACK_SANDBOX_PAYMENT" ||
    ![
      "PENDING",
      "APPROVED",
      "REJECTED",
      "EXPIRED",
      "CANCELLED",
      "EXECUTING",
      "VERIFIED",
      "FAILED",
      "UNVERIFIED",
    ].includes(text(r.status))
  )
    throw new Error("Unrecognized incident action");
  const expiry = text(r.expires_at);
  if (!Number.isFinite(Date.parse(expiry)))
    throw new Error("Invalid action expiry");
  return {
    id: text(r.id),
    incident_id: incidentId,
    action: text(r.action),
    status: text(r.status),
    expires_at: expiry,
    created_at: text(r.created_at),
    requested_by: text(r.requested_by),
    decided_by: r.decided_by === null ? null : text(r.decided_by),
    binding: binding(r.binding_json),
    events: r.events === undefined ? [] : array(r.events).map(record),
    result: r.result_json,
  };
}
export function fingerprint(value: Action) {
  return JSON.stringify({
    id: value.id,
    incident: value.incident_id,
    binding: value.binding,
    expires: value.expires_at,
    status: value.status,
  });
}
export function canDecide(
  value: Action,
  role: string,
  reviewed: string,
  now: number,
) {
  return (
    role === "ADMIN" &&
    value.status === "PENDING" &&
    Date.parse(value.expires_at) > now &&
    reviewed === fingerprint(value)
  );
}
