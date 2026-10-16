import express from "express";
import { randomUUID } from "node:crypto";
import { incidentRoutes } from "./incident-routes.js";
import { IncidentError, type IncidentStore } from "./incidents.js";
import {
  InvalidRegistryResponse,
  listServices,
  RegistryUnavailable,
  uuidPattern,
  type Registry,
} from "./services.js";

export type LogSink = (record: Record<string, unknown>) => void;
export function createApp(
  registry: Registry,
  log: LogSink = (record) => console.log(JSON.stringify(record)),
  incidents?: IncidentStore,
) {
  const app = express();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    const incoming = request.get("x-request-id");
    const id =
      incoming && uuidPattern.test(incoming)
        ? incoming.toLowerCase()
        : randomUUID();
    response.locals.requestId = id;
    response.set({
      "x-request-id": id,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    const started = performance.now();
    response.on("finish", () =>
      log({
        timestamp: new Date().toISOString(),
        service: "sentinel-api",
        event: "request_completed",
        request_id: id,
        status: response.statusCode,
        route:
          request.baseUrl === "/api/v1/incidents" &&
          ["/", "/:id", "/:id/events"].includes(request.route?.path)
            ? `/api/v1/incidents${request.route.path === "/" ? "" : request.route.path}`
            : ["/health", "/ready", "/api/v1/services"].includes(
                  request.route?.path,
                )
              ? request.route.path
              : "unmatched",
        duration_ms: Math.round((performance.now() - started) * 100) / 100,
      }),
    );
    next();
  });
  app.get("/health", (_request, response) =>
    response.json({ status: "ok", service: "sentinel-api" }),
  );
  app.get("/ready", async (_request, response) => {
    let ready = false;
    try {
      ready =
        (await registry.ready()) && (!incidents || (await incidents.ready()));
    } catch {
      /* Dependency details stay private. */
    }
    if (!ready) {
      response.status(503).json({
        error: {
          code: "NOT_READY",
          message: "Database or schema unavailable",
        },
        request_id: response.locals.requestId,
      });
      return;
    }
    response.json({ status: "ready", service: "sentinel-api" });
  });
  app.get("/api/v1/services", async (_request, response) => {
    response.json({ services: await listServices(registry) });
  });
  if (incidents) {
    app.use(
      "/api/v1/incidents",
      express.json({ limit: "8kb" }),
      incidentRoutes(incidents),
    );
  }
  app.use((_request, response) =>
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found" },
      request_id: response.locals.requestId,
    }),
  );
  const errors: express.ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    _next,
  ) => {
    let status: number | undefined;
    let code: string | undefined;
    let message: string | undefined;
    if (error instanceof IncidentError) ({ status, code, message } = error);
    else if (error && typeof error === "object" && "type" in error) {
      if (error.type === "entity.parse.failed") {
        status = 400;
        code = "INVALID_JSON";
        message = "Malformed JSON";
      }
      if (error.type === "entity.too.large") {
        status = 413;
        code = "PAYLOAD_TOO_LARGE";
        message = "Request body too large";
      }
    }
    if (status) {
      response.status(status).json({
        error: { code, message },
        request_id: response.locals.requestId,
      });
      return;
    }
    const unavailable = error instanceof RegistryUnavailable;
    const invalid = error instanceof InvalidRegistryResponse;
    response.status(unavailable ? 503 : 500).json({
      error: {
        code: unavailable
          ? "DATABASE_UNAVAILABLE"
          : invalid
            ? "INVALID_SERVICE_RESPONSE"
            : "INTERNAL_ERROR",
        message: unavailable
          ? "Service registry unavailable"
          : "Unexpected server error",
      },
      request_id: response.locals.requestId,
    });
  };
  app.use(errors);
  return app;
}
