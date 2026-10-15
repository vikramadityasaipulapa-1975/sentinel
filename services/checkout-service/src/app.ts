import express from "express";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "checkout-service" });
  });

  // Registered last so only requests without a matching route reach this handler.
  app.use((_request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  return app;
}
