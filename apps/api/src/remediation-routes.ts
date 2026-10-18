import { Router } from "express";
import { requirePermission } from "./auth.js";
import { IncidentError, parseId } from "./incidents.js";
import type { RemediationStore } from "./remediation-repository.js";
export function remediationRoutes(store: RemediationStore) {
  const r = Router();
  r.get(
    "/incidents/:id/remediations",
    requirePermission("READ"),
    async (req, res) =>
      res.json({ actions: await store.list(parseId(req.params.id)) }),
  );
  r.post(
    "/remediations/dry-run",
    requirePermission("WRITE_INCIDENT"),
    async (req, res) => {
      if (!req.is("application/json"))
        throw new IncidentError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json",
        );
      res.json(await store.preview(req.body));
    },
  );
  r.post(
    "/remediations",
    requirePermission("WRITE_INCIDENT"),
    async (req, res) => {
      if (!req.is("application/json"))
        throw new IncidentError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use application/json",
        );
      res.status(201).json(await store.propose(req.body, res.locals.user.id));
    },
  );
  r.get("/remediations/:id", requirePermission("READ"), async (req, res) =>
    res.json(await store.get(parseId(req.params.id))),
  );
  r.post(
    "/remediations/:id/decision",
    requirePermission("APPROVE_ACTION"),
    async (req, res) => {
      const b = req.body;
      if (
        !req.is("application/json") ||
        !b ||
        Object.keys(b).join() !== "decision" ||
        !["APPROVE", "REJECT"].includes(b.decision)
      )
        throw new IncidentError(
          400,
          "INVALID_DECISION",
          "Use only decision APPROVE or REJECT",
        );
      res.json(
        await store.decide(
          parseId(req.params.id),
          b.decision,
          res.locals.user.id,
        ),
      );
    },
  );
  return r;
}
