import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { uuidPattern } from "./contracts.js";

export interface LogRecord {
  timestamp: string;
  level: "info" | "warn" | "error";
  service: "checkout-service";
  event: "request_completed";
  request_id: string;
  route: string;
  status: number;
  duration_ms: number;
}
export type LogSink = (record: LogRecord) => void;
export const stdoutLog: LogSink = (record) =>
  console.log(JSON.stringify(record));

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function requestContext(log: LogSink): RequestHandler {
  return (request, response, next) => {
    const incoming = request.get("x-request-id");
    const requestId =
      incoming && uuidPattern.test(incoming)
        ? incoming.toLowerCase()
        : randomUUID();
    response.locals.requestId = requestId;
    response.set("x-request-id", requestId);
    const start = performance.now();
    response.on("finish", () => {
      const route = request.route?.path;
      log({
        timestamp: new Date().toISOString(),
        level:
          response.statusCode >= 500
            ? "error"
            : response.statusCode >= 400
              ? "warn"
              : "info",
        service: "checkout-service",
        event: "request_completed",
        request_id: requestId,
        route:
          route === "/health" || route === "/checkout" ? route : "unmatched",
        status: response.statusCode,
        duration_ms: Math.round((performance.now() - start) * 100) / 100,
      });
    });
    next();
  };
}

export const handleError: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  let status = 500;
  let code = "INTERNAL_ERROR";
  let message = "Unexpected server error";
  if (error instanceof HttpError) {
    ({ status, code, message } = error);
  } else if (error && typeof error === "object" && "type" in error) {
    if (error.type === "entity.parse.failed") {
      status = 400;
      code = "INVALID_JSON";
      message = "Malformed JSON";
    } else if (error.type === "entity.too.large") {
      status = 413;
      code = "PAYLOAD_TOO_LARGE";
      message = "Request body too large";
    }
  }
  response
    .status(status)
    .json({ error: { code, message }, request_id: response.locals.requestId });
};
