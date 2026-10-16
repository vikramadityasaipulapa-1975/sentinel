import type { RequestHandler } from "express";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import { type AuthService, AuthError, unauthorized } from "./auth.js";
import {
  encodeCursor,
  eventScope,
  parseId,
  parseList,
  type IncidentStore,
} from "./incidents.js";

// Limits are per API process; hosted ingress must also enforce a global budget.
export function streamRoute(
  store: IncidentStore,
  auth: AuthService,
): RequestHandler {
  const active = new Map<string, number>();
  let total = 0;
  return async (request, response) => {
    const id = parseId(request.params.id);
    if (Object.keys(request.query).length)
      throw new AuthError(
        400,
        "INVALID_STREAM",
        "Stream does not accept query parameters",
      );
    let position = parseList(
      request.get("last-event-id")
        ? { cursor: request.get("last-event-id") }
        : {},
      id,
    ).position;
    const expires = response.locals.authExpiresAt as number | undefined;
    if (!expires || expires * 1000 <= Date.now()) throw unauthorized();
    await store.get(id);
    const userId = response.locals.user.id as string;
    if (total >= 10 || (active.get(userId) ?? 0) >= 2)
      throw new AuthError(429, "STREAM_LIMIT", "Too many open streams");
    total++;
    active.set(userId, (active.get(userId) ?? 0) + 1);
    const abort = new AbortController();
    const closed = () => abort.abort();
    response.on("close", closed);
    const deadline = Math.min(expires * 1000, Date.now() + 60000);
    const timer = setTimeout(closed, Math.max(1, deadline - Date.now()));
    let sent = 0,
      checked = 0,
      heartbeat = 0;
    async function write(frame: string) {
      if (abort.signal.aborted || response.destroyed) return false;
      if (!response.write(frame))
        await once(response, "drain", {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        });
      return true;
    }
    response.set({
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    });
    response.flushHeaders();
    try {
      while (!abort.signal.aborted && sent < 500) {
        if (Date.now() - checked >= 5000) {
          try {
            await auth.authenticate(request.get("authorization"));
          } catch {
            await write("event: auth_expired\ndata: {}\n\n");
            break;
          }
          checked = Date.now();
        }
        const page = await store.events(id, { limit: 50, position });
        for (const event of page.events) {
          if (Date.now() >= deadline || sent >= 500) break;
          const cursor = encodeCursor(event.sequence, eventScope(id));
          if (
            !(await write(
              `id: ${cursor}\nevent: incident_event\ndata: ${JSON.stringify(event)}\n\n`,
            ))
          )
            break;
          position = event.sequence;
          sent++;
        }
        if (Date.now() - heartbeat >= 10000) {
          await write(": heartbeat\n\n");
          heartbeat = Date.now();
        }
        if (!page.next_cursor)
          await pause(1000, undefined, { signal: abort.signal });
      }
    } catch {
      if (!abort.signal.aborted) {
        try {
          await write("event: stream_error\ndata: {}\n\n");
        } catch {
          /* Disconnected or slow consumer. */
        }
      }
    } finally {
      clearTimeout(timer);
      abort.abort();
      response.off("close", closed);
      active.set(userId, (active.get(userId) ?? 1) - 1);
      if (!active.get(userId)) active.delete(userId);
      total--;
      if (!response.destroyed) response.end();
    }
  };
}
