import { Router, type Request } from "express";
import {
  IncidentError,
  parseCreate,
  parseId,
  parseList,
  parseTransition,
  type IncidentStore,
} from "./incidents.js";

export function incidentRoutes(store: IncidentStore) {
  const router = Router();
  function json(request: Request) {
    if (!request.is("application/json"))
      throw new IncidentError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Use application/json",
      );
  }
  router.post("/", async (request, response) => {
    json(request);
    const incident = await store.create(parseCreate(request.body));
    response
      .location(`/api/v1/incidents/${incident.id}`)
      .status(201)
      .json(incident);
  });
  router.get("/", async (request, response) =>
    response.json(await store.list(parseList(request.query))),
  );
  router.get("/:id/events", async (request, response) => {
    const id = parseId(request.params.id);
    response.json(await store.events(id, parseList(request.query, id)));
  });
  router.get("/:id", async (request, response) =>
    response.json(await store.get(parseId(request.params.id))),
  );
  router.patch("/:id", async (request, response) => {
    json(request);
    response.json(
      await store.transition(
        parseId(request.params.id),
        parseTransition(request.body),
      ),
    );
  });
  return router;
}
