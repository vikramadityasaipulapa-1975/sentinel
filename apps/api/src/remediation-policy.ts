import { IncidentError, parseId } from "./incidents.js";

export const ACTION = "ROLLBACK_SANDBOX_PAYMENT";
export const SANDBOX = "sentinel-remediation-sandbox";
export const imageId = /^sha256:[a-f0-9]{64}$/;
export interface SandboxBinding {
  project: string;
  container_id: string;
  current_image: string;
  current_version: string;
  target_image: string;
  target_version: string;
}
export function denied(
  message = "Sandbox action preconditions are not satisfied",
): never {
  throw new IncidentError(409, "ACTION_NOT_ELIGIBLE", message);
}
export function parseProposal(input: unknown) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join() !==
      ["action", "incident_id", "idempotency_key"].sort().join()
  )
    throw new IncidentError(
      400,
      "INVALID_ACTION",
      "Use the exact allowlisted proposal fields",
    );
  const row = input as Record<string, unknown>;
  if (row.action !== ACTION)
    throw new IncidentError(400, "UNSUPPORTED_ACTION", "Unsupported action");
  return {
    action: ACTION,
    incident_id: parseId(row.incident_id),
    idempotency_key: parseId(row.idempotency_key),
  };
}
export function assertBinding(value: SandboxBinding): void {
  if (
    value.project !== SANDBOX ||
    !/^[a-f0-9]{64}$/.test(value.container_id) ||
    !imageId.test(value.current_image) ||
    !imageId.test(value.target_image) ||
    value.target_version !== "payment-v1" ||
    !["payment-v2-timeout", "payment-v3-error"].includes(
      value.current_version,
    ) ||
    value.current_image === value.target_image
  )
    denied();
}
export function dryRun(
  service: string,
  incidentStatus: string,
  binding: SandboxBinding,
) {
  assertBinding(binding);
  if (
    service !== "payment-service" ||
    ["RESOLVED", "CLOSED"].includes(incidentStatus)
  )
    denied();
  return {
    action: ACTION,
    scope: "LOCAL_SANDBOX_ONLY",
    binding,
    approval_required: true,
    execution_performed: false,
    expires_in_seconds: 600,
  };
}
