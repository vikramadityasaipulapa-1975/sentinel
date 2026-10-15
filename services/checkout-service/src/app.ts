import express from "express";
import { readConfig, type Config } from "./config.js";
import { isPaymentRequest } from "./contracts.js";
import { pay, PaymentError } from "./payment-client.js";

export function createApp(config: Config = readConfig()) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "8kb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "checkout-service" });
  });

  app.post("/checkout", async (request, response) => {
    if (!request.is("application/json")) {
      response.status(415).json({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Use application/json" } });
      return;
    }
    if (!isPaymentRequest(request.body)) {
      response.status(422).json({ error: { code: "INVALID_CHECKOUT", message: "Invalid checkout fields" } });
      return;
    }
    try {
      const payment = await pay(request.body, config);
      response.status(201).json(payment);
    } catch (error) {
      if (!(error instanceof PaymentError)) throw error;
      response.status(error.status).json({ error: { code: error.code, message: "Payment could not be confirmed" } });
    }
  });

  // Registered last so only requests without a matching route reach this handler.
  app.use((_request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  return app;
}
