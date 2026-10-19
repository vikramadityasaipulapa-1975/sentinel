import { dashboardRoutes } from "./dashboard.js";
import { remediationRoutes } from "./remediation-routes.js";
import type { RemediationStore } from "./remediation-repository.js";
import express from "express";
import { alertRoutes, type AlertStore } from "./alert-ingestion.js";
import { streamRoute } from "./incident-stream.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  authenticated,
  AuthError,
  parseLogin,
  requirePermission,
  type AuthService,
} from "./auth.js";
import { incidentRoutes } from "./incident-routes.js";
import { investigationRoutes } from "./investigation-routes.js";
import type { InvestigationStore } from "./investigations.js";
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
  auth?: AuthService,
  investigations?: InvestigationStore,
  alerts?: AlertStore,
  remediations?: RemediationStore,
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
              : [
                    "/api/v1/auth/login",
                    "/api/v1/auth/me",
                    "/auth-test",
                    "/auth-test.js",
                    "/auth-test.css",
                  ].includes(request.route?.path)
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
        (await registry.ready()) &&
        (!incidents || (await incidents.ready())) &&
        (!auth || (await auth.ready()));
      if (ready && investigations) ready = await investigations.ready();
      if (ready && alerts) ready = await alerts.ready();
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
  const publicDirectory = fileURLToPath(
    new URL("../../public/", import.meta.url),
  );
  for (const [route, filename] of [
    ["/auth-test", "auth-test.html"],
    ["/auth-test.js", "auth-test.js"],
    ["/auth-test.css", "auth-test.css"],
  ]) {
    app.get(route, (_request, response) => {
      response.set(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      );
      response.set("referrer-policy", "no-referrer");
      response.sendFile(filename, { root: publicDirectory });
    });
  }
  app.use(dashboardRoutes());
  app.post(
    "/api/v1/auth/login",
    express.json({ limit: "8kb" }),
    async (request, response) => {
      if (!request.is("application/json"))
        throw new AuthError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json",
        );
      const input = parseLogin(request.body);
      if (!auth)
        throw new AuthError(
          503,
          "AUTH_UNAVAILABLE",
          "Authentication unavailable",
        );
      response.json(
        await auth.login(
          input.email,
          input.password,
          request.socket.remoteAddress ?? "unknown",
        ),
      );
    },
  );
  app.use("/api/v1/webhooks/alertmanager", alertRoutes(alerts));
  app.use("/api/v1", authenticated(auth));
  app.get("/api/v1/auth/me", (_request, response) =>
    response.json({ user: response.locals.user }),
  );
  app.get(
    "/api/v1/services",
    requirePermission("READ"),
    async (_request, response) => {
      response.json({ services: await listServices(registry) });
    },
  );
  if (incidents && auth)
    app.get(
      "/api/v1/incidents/:id/stream",
      requirePermission("READ"),
      streamRoute(incidents, auth),
    );
  if (incidents) {
    app.use(
      "/api/v1/incidents",
      (request, response, next) =>
        requirePermission(
          ["POST", "PATCH"].includes(request.method)
            ? "WRITE_INCIDENT"
            : "READ",
        )(request, response, next),
      express.json({ limit: "8kb" }),
      incidentRoutes(incidents),
    );
  }
  if (investigations)
    app.use(
      "/api/v1",
      express.json({ limit: "8kb" }),
      investigationRoutes(investigations),
    );
  if (remediations)
    app.use(
      "/api/v1",
      express.json({ limit: "8kb" }),
      remediationRoutes(remediations),
    );
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
    if (response.headersSent) {
      response.destroy();
      return;
    }
    let status: number | undefined;
    let code: string | undefined;
    let message: string | undefined;
    if (error instanceof IncidentError || error instanceof AuthError)
      ({ status, code, message } = error);
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
      if (status === 401) response.set("www-authenticate", "Bearer");
      if (code === "AUTH_BUSY") response.set("retry-after", "1");
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
