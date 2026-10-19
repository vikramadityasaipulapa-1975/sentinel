import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { message, services } from "../api/client";
import { incident, incidentPage, severities, statuses } from "../api/incidents";
import { useSession } from "../auth/Session";
import { Badge, Notice, useLoad, When } from "../components/Common";
export function Incidents() {
  const { api, token, user } = useSession(),
    [params, setParams] = useSearchParams(),
    navigate = useNavigate();
  const status = params.get("status") ?? "",
    service = params.get("service_id") ?? "",
    cursor = params.get("cursor") ?? "";
  const query = new URLSearchParams({ limit: "20" });
  if (status) query.set("status", status);
  if (service) query.set("service_id", service);
  if (cursor) query.set("cursor", cursor);
  const state = useLoad(
    async (signal) =>
      incidentPage(await api(`/api/v1/incidents?${query}`, {}, signal)),
    [token, status, service, cursor],
  );
  const registry = useLoad(
    async (signal) => services(await api("/api/v1/services", {}, signal)),
    [token],
  );
  const [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete("cursor");
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const saved = incident(
        await api("/api/v1/incidents", {
          method: "POST",
          body: JSON.stringify({
            service_id: form.get("service"),
            title: String(form.get("title")).trim(),
            severity: form.get("severity"),
          }),
        }),
      );
      navigate(`/incidents/${saved.id}`);
    } catch (error) {
      setError(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">INCIDENT RESPONSE</p>
          <h1>Incidents</h1>
          <p className="muted">Track impact. Investigate with evidence.</p>
        </div>
        {user?.role !== "VIEWER" && (
          <button
            className="primary"
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "Close form" : "Create incident"}
          </button>
        )}
      </header>
      {creating && user?.role !== "VIEWER" && (
        <section className="panel">
          <h2>Create incident</h2>
          <form onSubmit={create}>
            {error && <Notice>{error}</Notice>}
            <label>
              Service
              <select name="service" required defaultValue="">
                <option value="" disabled>
                  Select service
                </option>
                {registry.data?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Title
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Describe the observed impact"
              />
            </label>
            <label>
              Severity
              <select name="severity" defaultValue="HIGH">
                {severities.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !registry.data?.length}
              className="primary"
            >
              {busy ? "Creating…" : "Save incident"}
            </button>
          </form>
        </section>
      )}
      <div className="filters">
        <label>
          Status
          <select
            value={status}
            onChange={(e) => filter("status", e.target.value)}
          >
            <option value="">All statuses</option>
            {statuses.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Service filter
          <select
            value={service}
            onChange={(e) => filter("service_id", e.target.value)}
          >
            <option value="">All services</option>
            {registry.data?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={state.refresh}>Refresh incidents</button>
      </div>
      {registry.error && (
        <Notice>Service names unavailable: {registry.error}</Notice>
      )}
      {state.error && <Notice>{state.error}</Notice>}
      {state.loading && <p role="status">Loading incidents…</p>}
      {state.data && (
        <>
          <div className="incident-list">
            {state.data.incidents.map((row) => (
              <Link
                className="incident-row"
                to={`/incidents/${row.id}`}
                key={row.id}
              >
                <span className="incident-main">
                  <strong>{row.title}</strong>
                  <span className="muted small">
                    {registry.data?.find((s) => s.id === row.service_id)
                      ?.name ?? row.service_id}{" "}
                    · <When value={row.started_at} />
                  </span>
                </span>
                <Badge value={row.severity} />
                <Badge value={row.status} />
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
          {!state.data.incidents.length && (
            <section className="panel empty">
              <h2>No incidents match</h2>
              <p className="muted">
                Change your filters or create an incident when an issue is
                observed.
              </p>
            </section>
          )}
          <div className="toolbar">
            {cursor && (
              <button
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete("cursor");
                  setParams(next);
                }}
              >
                Newest page
              </button>
            )}
            {state.data.next && (
              <button
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("cursor", state.data!.next!);
                  setParams(next);
                }}
              >
                Older incidents
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
