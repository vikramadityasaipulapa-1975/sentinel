import { EvidenceWorkspace } from "../components/EvidenceWorkspace";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { message, services } from "../api/client";
import { incident, transitions } from "../api/incidents";
import { useSession } from "../auth/Session";
import { Badge, Notice, useLoad, When } from "../components/Common";
export function IncidentDetail() {
  const { id = "" } = useParams(),
    { api, token, user } = useSession();
  const state = useLoad(
    async (signal) =>
      incident(
        await api(`/api/v1/incidents/${encodeURIComponent(id)}`, {}, signal),
      ),
    [token, id],
  );
  const registry = useLoad(
    async (signal) => services(await api("/api/v1/services", {}, signal)),
    [token],
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  async function change(status: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      incident(
        await api(`/api/v1/incidents/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      );
      state.refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back" to="/incidents">
        ← All incidents
      </Link>
      {state.loading && <p role="status">Loading incident…</p>}
      {state.error && <Notice>{state.error}</Notice>}
      {state.data && (
        <>
          <header className="page-header">
            <div>
              <p className="eyebrow">
                {registry.data?.find((s) => s.id === state.data!.service_id)
                  ?.name ?? "INCIDENT"}
              </p>
              <h1>{state.data.title}</h1>
              <div className="toolbar">
                <Badge value={state.data.severity} />
                <Badge value={state.data.status} />
              </div>
            </div>
            <button onClick={state.refresh}>Refresh incident</button>
          </header>
          <section className="panel">
            <dl className="metadata">
              <div>
                <dt>Incident ID</dt>
                <dd>
                  <code>{state.data.id}</code>
                </dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>
                  <When value={state.data.started_at} />
                </dd>
              </div>
              <div>
                <dt>Resolved</dt>
                <dd>
                  <When value={state.data.resolved_at} />
                </dd>
              </div>
            </dl>
            {error && <Notice>{error}</Notice>}
            {user?.role !== "VIEWER" &&
              transitions[state.data.status].length > 0 && (
                <div className="toolbar" aria-label="Incident status actions">
                  {transitions[state.data.status].map((value) => (
                    <button
                      key={value}
                      disabled={busy}
                      onClick={() => void change(value)}
                    >
                      Mark {value.toLowerCase()}
                    </button>
                  ))}
                </div>
              )}
          </section>
          <EvidenceWorkspace key={id} incidentId={id} />
        </>
      )}
    </>
  );
}
