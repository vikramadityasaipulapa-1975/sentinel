import { Counter, Histogram, Registry } from "@prometheus-io/client";
import type { RequestHandler } from "express";

const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export function createMetrics() {
  // One registry per app prevents cross-test and duplicate-registration leakage.
  const registry = new Registry();
  registry.setDefaultLabels({ service: "checkout-service" });
  const labels = ["method", "route", "status_code"] as const;
  const requests = new Counter({
    name: "sentinel_http_requests_total",
    help: "Completed HTTP responses, excluding metrics scrapes",
    labelNames: labels,
    registers: [registry],
  });
  const duration = new Histogram({
    name: "sentinel_http_request_duration_seconds",
    help: "Time from request middleware entry to response completion in seconds",
    labelNames: labels,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  const observe: RequestHandler = (request, response, next) => {
    if (request.path === "/metrics") {
      next();
      return;
    }
    const start = performance.now();
    response.once("finish", () => {
      const path = request.route?.path;
      const values = {
        method: methods.has(request.method) ? request.method : "OTHER",
        route: path === "/health" || path === "/checkout" ? path : "unmatched",
        status_code: String(response.statusCode),
      };
      requests.inc(values);
      duration.observe(values, (performance.now() - start) / 1000);
    });
    next();
  };
  const expose: RequestHandler = async (_request, response) => {
    response.set("cache-control", "no-store");
    response.set("content-type", registry.contentType);
    response.send(await registry.metrics());
  };
  return { observe, expose };
}
