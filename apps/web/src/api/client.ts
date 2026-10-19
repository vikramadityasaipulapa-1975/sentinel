export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
export async function request(
  path: string,
  token: string | null,
  options: RequestInit = {},
  signal?: AbortSignal,
): Promise<unknown> {
  if (!path.startsWith("/api/v1/")) throw new Error("Unsupported API path");
  const headers = new Headers(options.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: "omit",
      cache: "no-store",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      0,
      "NETWORK_UNAVAILABLE",
      "Cannot reach Sentinel. Check the backend and try again.",
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "The server returned an unreadable response.",
    );
  }
  if (!response.ok) {
    const error = record(record(data).error ?? {});
    throw new ApiError(
      response.status,
      typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      typeof error.message === "string" ? error.message : "Request failed.",
      response.headers.get("x-request-id") ?? undefined,
    );
  }
  return data;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unexpected server data");
  return value as Record<string, unknown>;
}
export function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Unexpected server text");
  return value;
}
export function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Unexpected server list");
  return value;
}
export function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected error occurred.";
}
export type Profile = {
  id: string;
  email: string;
  role: "VIEWER" | "OPERATOR" | "ADMIN";
};
export function profile(value: unknown): Profile {
  const row = record(value);
  if (!["VIEWER", "OPERATOR", "ADMIN"].includes(text(row.role)))
    throw new Error("Invalid account role");
  return {
    id: text(row.id),
    email: text(row.email),
    role: row.role as Profile["role"],
  };
}
export type Service = {
  id: string;
  name: string;
  owner: string;
  environment: string;
};
export function services(value: unknown): Service[] {
  return array(record(value).services).map((value) => {
    const row = record(value);
    return {
      id: text(row.id),
      name: text(row.name),
      owner: text(row.owner),
      environment: text(row.environment),
    };
  });
}
