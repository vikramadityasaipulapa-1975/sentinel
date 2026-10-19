import express from "express";
import { tracing } from "./tracing.js";
import { createMetrics } from "./metrics.js";
import { paymentLimits, readConfig, type Config } from "./config.js";
import { isPaymentRequest, uuidPattern } from "./contracts.js";
import { pay, PaymentError } from "./payment-client.js";
import { PaymentGate } from "./resilience.js";
import {
  handleError,
  HttpError,
  requestContext,
  stdoutLog,
  type LogSink,
} from "./http.js";

export function createApp(
  config: Config = readConfig(),
  log: LogSink = stdoutLog,
) {
  const app = express();
  const payments = new PaymentGate(paymentLimits(config));
  app.disable("x-powered-by");
  const metrics = createMetrics();
  app.use(metrics.observe);
  app.use(tracing().middleware);
  app.use(requestContext(log));
  app.get("/metrics", metrics.expose);
  app.use(express.json({ limit: "8kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "checkout-service" });
  });

  app.post("/checkout", async (request, response) => {
    if (!request.is("application/json")) {
      throw new HttpError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Use application/json",
      );
    }
    if (!isPaymentRequest(request.body)) {
      throw new HttpError(422, "INVALID_CHECKOUT", "Invalid checkout fields");
    }
    const key = request.get("idempotency-key") ?? request.body.order_id;
    if (!uuidPattern.test(key))
      throw new HttpError(
        422,
        "INVALID_IDEMPOTENCY_KEY",
        "Idempotency-Key must be a UUID",
      );
    const release = payments.acquire();
    let healthy = false;
    try {
      const payment = await pay(
        request.body,
        config,
        response.locals.requestId,
        key.toLowerCase(),
        response.locals.trace,
      );
      healthy = true;
      response.status(201).json(payment);
    } catch (error) {
      // A business conflict proves reachability; it must not trip the breaker.
      healthy = error instanceof PaymentError && error.status < 500;
      throw error;
    } finally {
      release(healthy);
    }
  });

  // Registered last so only requests without a matching route reach this handler.
  app.use((_request, _response) => {
    throw new HttpError(404, "NOT_FOUND", "Route not found");
  });
  app.use(handleError);

  return app;
}
