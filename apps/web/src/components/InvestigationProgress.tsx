import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { message, record, text } from "../api/client";
import {
  frames,
  mergeEvents,
  timelineEvent,
  type TimelineEvent,
} from "../api/stream";
import { useSession } from "../auth/Session";
import { Badge, Notice, When } from "./Common";
export function LiveTimeline({
  incidentId,
  onTerminal,
}: {
  incidentId: string;
  onTerminal: () => void;
}) {
  const { token, expire } = useSession();
  const [events, setEvents] = useState<TimelineEvent[]>([]),
    [status, setStatus] = useState("Connecting to saved history…"),
    [enabled, setEnabled] = useState(true),
    [revision, setRevision] = useState(0);
  const terminal = useRef(onTerminal);
  terminal.current = onTerminal;
  useEffect(() => {
    if (!enabled || !token) return;
    const controller = new AbortController();
    let cursor: string | undefined;
    const seen = new Set<string>();
    setEvents([]);
    async function watch() {
      for (
        let attempt = 0;
        attempt < 5 && !controller.signal.aborted;
        attempt++
      ) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const connection = new AbortController();
        const stopConnection = () => connection.abort();
        controller.signal.addEventListener("abort", stopConnection, {
          once: true,
        });
        let idleTimer = setTimeout(stopConnection, 30000);
        const received = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(stopConnection, 30000);
        };
        try {
          setStatus(
            attempt
              ? "Reconnecting from the last received event…"
              : "Loading saved history and following updates…",
          );
          const response = await fetch(
            `/api/v1/incidents/${incidentId}/stream`,
            {
              headers: {
                authorization: `Bearer ${token}`,
                ...(cursor ? { "last-event-id": cursor } : {}),
              },
              cache: "no-store",
              credentials: "omit",
              signal: connection.signal,
            },
          );
          if (response.status === 401) {
            expire();
            return;
          }
          if (!response.ok)
            throw new Error(
              response.status === 429
                ? "Too many active progress streams. Stop another tab and reconnect."
                : `Progress unavailable (HTTP ${response.status}).`,
            );
          if (
            !response.headers
              .get("content-type")
              ?.includes("text/event-stream") ||
            !response.body
          )
            throw new Error("Unexpected progress response");
          setStatus("Following saved and live events");
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!controller.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            received();
            buffer += decoder.decode(chunk.value, { stream: true });
            const parsed = frames(buffer);
            buffer = parsed.remaining;
            for (const frame of parsed.complete) {
              if (frame.event === "auth_expired") {
                expire();
                return;
              }
              if (frame.event !== "incident_event") continue;
              const event = timelineEvent(JSON.parse(frame.data), incidentId);
              if (!frame.id || frame.id.length > 1024)
                throw new Error("Invalid replay cursor");
              cursor = frame.id;
              setEvents((old) => mergeEvents(old, event));
              if (
                !seen.has(event.id) &&
                ["COMPLETED", "PARTIAL", "FAILED"].includes(
                  String(event.payload.event),
                )
              ) {
                seen.add(event.id);
                terminal.current();
              }
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          setStatus(message(error));
        } finally {
          clearTimeout(idleTimer);
          controller.signal.removeEventListener("abort", stopConnection);
          connection.abort();
          try {
            await reader?.cancel();
          } catch {
            /* Aborted streams may already be closed. */
          }
        }
        if (!controller.signal.aborted)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(
              resolve,
              Math.min((attempt + 1) * 1000, 5000),
            );
            controller.signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
          });
      }
      if (!controller.signal.aborted)
        setStatus(
          "Reconnect limit reached. Select Reconnect to replay saved history.",
        );
    }
    void watch();
    return () => controller.abort();
  }, [token, incidentId, enabled, revision, expire]);
  return (
    <section className="panel" aria-label="Incident timeline">
      <div className="section-heading">
        <h2>Incident timeline</h2>
        <div className="toolbar">
          <button
            onClick={() => {
              setEnabled(true);
              setRevision((value) => value + 1);
            }}
          >
            Reconnect
          </button>
          <button
            disabled={!enabled}
            onClick={() => {
              setEnabled(false);
              setStatus(
                "Live updates paused. Saved events remain in the backend.",
              );
            }}
          >
            Pause updates
          </button>
        </div>
      </div>
      <p role="status" className="small muted">
        {status}
      </p>
      <p className="small muted">
        Latest 100 received events · ordered by saved sequence · investigation
        completion does not resolve the incident.
      </p>
      <ol className="timeline">
        {events.map((event) => (
          <li key={event.id}>
            <div className="timeline-heading">
              <Badge
                value={String(
                  event.payload.event ?? event.payload.status ?? event.type,
                )}
              />
              <When value={event.occurred_at} />
              <span className="small muted">#{event.sequence}</span>
            </div>
            <details>
              <summary>{event.type.replaceAll("_", " ")} details</summary>
              <pre className="raw" tabIndex={0}>
                {JSON.stringify(event.payload, null, 2)}
              </pre>
            </details>
          </li>
        ))}
      </ol>
      {!events.length && <p className="muted">No events received yet.</p>}
    </section>
  );
}
export function InvestigationStart({
  incidentId,
  onQueued,
}: {
  incidentId: string;
  onQueued: (id: string) => void;
}) {
  const { api, user } = useSession();
  const [params, setParams] = useSearchParams();
  const [key, setKey] = useState(() => crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = useRef(false);
  async function start() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const run = record(
        await api(`/api/v1/incidents/${incidentId}/investigations`, {
          method: "POST",
          headers: { "idempotency-key": key },
          body: "{}",
        }),
      );
      const id = text(run.id);
      const next = new URLSearchParams(params);
      next.set("investigation", id);
      setParams(next);
      setNotice(
        `Investigation accepted: ${id}. Follow the timeline for its confirmed outcome.`,
      );
      onQueued(id);
    } catch (error) {
      setError(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Collect evidence</h2>
      <p className="muted">
        A read-only investigation collects a new bounded evidence window. It
        does not execute remediation.
      </p>
      {error && (
        <Notice>
          {error} Retrying uses the same request key to avoid duplicate work.
        </Notice>
      )}
      {notice && <p role="status">{notice}</p>}
      {user?.role === "VIEWER" ? (
        <p className="muted">
          An OPERATOR or ADMIN can start an investigation.
        </p>
      ) : (
        <div className="toolbar">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void start()}
          >
            {busy ? "Submitting…" : "Start investigation"}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setKey(crypto.randomUUID());
              setNotice("New request key ready for a separate investigation.");
              setError("");
            }}
          >
            New investigation key
          </button>
        </div>
      )}
    </section>
  );
}
