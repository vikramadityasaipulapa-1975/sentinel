import { services } from "../api/client";
import { useSession } from "../auth/Session";
import { Notice, useLoad } from "../components/Common";
export function Services() {
  const { api, token } = useSession();
  const state = useLoad(
    async (signal) => services(await api("/api/v1/services", {}, signal)),
    [token],
  );
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>Service overview</h1>
          <p className="muted">Registered services and their ownership.</p>
        </div>
        <button onClick={state.refresh}>Refresh services</button>
      </header>
      {state.loading && <p role="status">Loading services…</p>}
      {state.error && <Notice>{state.error}</Notice>}
      {state.data && (
        <>
          <div className="summary">
            <strong>{state.data.length.toString().padStart(2, "0")}</strong>
            <span>registered services</span>
            <span className="muted">
              Registry data · not a health assessment
            </span>
          </div>
          <div className="service-grid">
            {state.data.map((service) => (
              <article className="panel service-card" key={service.id}>
                <p className="eyebrow">{service.environment}</p>
                <h2>{service.name}</h2>
                <p className="muted">Owned by {service.owner}</p>
                <code>{service.id}</code>
              </article>
            ))}
          </div>
          {!state.data.length && (
            <div className="panel">No services registered yet.</div>
          )}
        </>
      )}
    </>
  );
}
