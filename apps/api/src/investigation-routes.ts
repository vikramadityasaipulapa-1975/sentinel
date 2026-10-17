import { Router } from "express";
import { requirePermission } from "./auth.js";
import { IncidentError, parseId } from "./incidents.js";
import type { InvestigationStore } from "./investigations.js";

export function investigationRoutes(store: InvestigationStore) {
  const router = Router();
  router.post(
    "/incidents/:id/investigations",
    requirePermission("WRITE_INCIDENT"),
    async (request, response) => {
      if (!request.is("application/json"))
        throw new IncidentError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json",
        );
      if (
        !request.body ||
        typeof request.body !== "object" ||
        Array.isArray(request.body) ||
        Object.keys(request.body).length
      )
        throw new IncidentError(
          422,
          "INVALID_INVESTIGATION",
          "Provide an empty JSON object",
        );
      const key = parseId(request.get("idempotency-key"));
      const value = await store.enqueue(
        parseId(request.params.id),
        response.locals.user.id,
        key,
      );
      response
        .status(202)
        .location(`/api/v1/investigations/${value.id}`)
        .json(value);
    },
  );
  router.get(
    "/incidents/:id/investigations",
    requirePermission("READ"),
    async (request, response) =>
      response.json(
        await store.list(parseId(request.params.id), request.query),
      ),
  );
  router.get(
    "/investigations/:id",
    requirePermission("READ"),
    async (request, response) =>
      response.json(await store.get(parseId(request.params.id))),
  );
  router.get(
    "/investigations/:id/evidence",
    requirePermission("READ"),
    async (request, response) =>
      response.json(
        await store.evidence(parseId(request.params.id), request.query),
      ),
  );
  return router;
}
