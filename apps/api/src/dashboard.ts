import express, { Router } from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function dashboardRoutes() {
  const router = Router();
  const directory = fileURLToPath(
    new URL("../../../web/dist/", import.meta.url),
  );
  if (!existsSync(directory + "index.html")) return router;
  router.use((_request, response, next) => {
    response.set({
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "referrer-policy": "no-referrer",
    });
    next();
  });
  router.use("/dashboard", express.static(directory, { index: false }));
  router.get(/^\/dashboard(?:\/.*)?$/, (request, response) => {
    if (request.path.startsWith("/dashboard/assets/")) {
      response.status(404).end();
      return;
    }
    response.sendFile("index.html", { root: directory });
  });
  return router;
}
