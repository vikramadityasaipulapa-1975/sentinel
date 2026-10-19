import { useEffect, useRef, useState } from "react";
import { array, message, record, text } from "../api/client";
import {
  action,
  binding,
  canDecide,
  fingerprint,
  type Binding,
} from "../api/actions";
import { useSession } from "../auth/Session";
import { Badge, Notice, useLoad, When } from "./Common";
import { Confirmation } from "./Confirmation";
function BindingView({ value }: { value: Binding }) {
  return (
    <dl className="provenance binding">
      <dt>Project · local sandbox only</dt>
      <dd>{value.project}</dd>
      <dt>Exact container</dt>
      <dd>
        <code>{value.container_id}</code>
      </dd>
      <dt>Current version / image</dt>
      <dd>
        {value.current_version}
        <code className="hash">{value.current_image}</code>
      </dd>
      <dt>Target version / image</dt>
      <dd>
        {value.target_version}
        <code className="hash">{value.target_image}</code>
      </dd>
    </dl>
  );
}
export function Remediations({
  incidentId,
  revision = 0,
}: {
  incidentId: string;
  revision?: number;
}) {
  const { api, token, user } = useSession();
  const [selected, setSelected] = useState(""),
    [key, setKey] = useState(() => crypto.randomUUID()),
    [preview, setPreview] = useState<Binding | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reviewed, setReviewed] = useState(""),
    [confirm, setConfirm] = useState<"APPROVE" | "REJECT" | null>(null),
    [now, setNow] = useState(Date.now());
  const pending = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const list = useLoad(
    async (signal) =>
      array(
        record(
          await api(`/api/v1/incidents/${incidentId}/remediations`, {}, signal),
        ).actions,
      ).map((value) => action(value, incidentId)),
    [token, incidentId, revision],
  );
  const detail = useLoad(
    async (signal) =>
      selected
        ? action(
            await api(`/api/v1/remediations/${selected}`, {}, signal),
            incidentId,
          )
        : null,
    [token, incidentId, selected, revision],
  );
  const proposal = {
    action: "ROLLBACK_SANDBOX_PAYMENT",
    incident_id: incidentId,
    idempotency_key: key,
  };
  const canWrite = user?.role !== "VIEWER";
  const eligible =
    detail.data &&
    detail.data.id === selected &&
    canDecide(detail.data, user?.role ?? "", reviewed, now);
  async function run(kind: "preview" | "propose") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setReviewed("");
    try {
      if (kind === "preview") {
        const row = record(
          await api("/api/v1/remediations/dry-run", {
            method: "POST",
            body: JSON.stringify(proposal),
          }),
        );
        if (
          row.scope !== "LOCAL_SANDBOX_ONLY" ||
          row.execution_performed !== false
        )
          throw new Error("Unexpected dry-run scope");
        setPreview(binding(row.binding));
      } else {
        const saved = action(
          await api("/api/v1/remediations", {
            method: "POST",
            body: JSON.stringify(proposal),
          }),
          incidentId,
        );
        setSelected(saved.id);
        setPreview(null);
        list.refresh();
        detail.refresh();
      }
    } catch (error) {
      setError(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function decide() {
    if (!detail.data || !confirm || !eligible || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const id = detail.data.id;
    try {
      await api(`/api/v1/remediations/${id}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision: confirm }),
      });
      detail.refresh();
      list.refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
      setConfirm(null);
      setReviewed("");
    }
  }
  return (
    <section className="panel" aria-label="Sandbox remediation">
      <p className="eyebrow">HUMAN AUTHORIZATION</p>
      <div className="section-heading">
        <h2>Sandbox rollback & audit</h2>
        <Badge value="LOCAL_SANDBOX_ONLY" />
      </div>
      <p className="muted">
        Only the separate simulated payment sandbox can change. A hypothesis or
        runbook cannot authorize execution.
      </p>
      {error && <Notice>{error}</Notice>}
      {canWrite && (
        <>
          <div className="toolbar">
            <button disabled={busy} onClick={() => void run("preview")}>
              Preview sandbox rollback
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setKey(crypto.randomUUID());
                setPreview(null);
                setReviewed("");
                setError("");
              }}
            >
              New proposal key
            </button>
          </div>
          {preview && (
            <section className="preview">
              <h3>Dry run · no execution</h3>
              <BindingView value={preview} />
              <button
                className="primary"
                disabled={busy}
                onClick={() => void run("propose")}
              >
                Create pending proposal
              </button>
            </section>
          )}
        </>
      )}
      <div className="toolbar">
        <button
          onClick={() => {
            list.refresh();
            detail.refresh();
            setReviewed("");
          }}
        >
          Refresh proposals & audit
        </button>
      </div>
      {list.loading && <p role="status">Loading proposals…</p>}
      {list.error && <Notice>{list.error}</Notice>}
      {list.data?.length === 0 && (
        <p className="muted">No proposals for this incident.</p>
      )}
      {!!list.data?.length && (
        <label className="run-picker">
          Saved sandbox proposal
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setReviewed("");
              setConfirm(null);
            }}
          >
            <option value="">Select a proposal</option>
            {list.data.map((row) => (
              <option key={row.id} value={row.id}>
                {row.status} · {row.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      )}
      {detail.error && <Notice>{detail.error}</Notice>}
      {detail.loading && selected && (
        <p role="status">Loading exact proposal…</p>
      )}
      {detail.data && detail.data.id === selected && (
        <>
          <div className="toolbar">
            <Badge value={detail.data.status} />
            <code>{detail.data.id}</code>
          </div>
          <BindingView value={detail.data.binding} />
          <p className="small muted">
            Requested by {detail.data.requested_by} · created{" "}
            <When value={detail.data.created_at} />
            <br />
            Expires <When value={detail.data.expires_at} /> · decided by{" "}
            {detail.data.decided_by ?? "No decision"}
          </p>
          {Date.parse(detail.data.expires_at) <= now &&
            detail.data.status === "PENDING" && (
              <Notice>
                This proposal has expired. The backend will reject an approval.
              </Notice>
            )}
          {user?.role === "ADMIN" && detail.data.status === "PENDING" && (
            <>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={reviewed === fingerprint(detail.data)}
                  onChange={(e) =>
                    setReviewed(
                      e.target.checked ? fingerprint(detail.data!) : "",
                    )
                  }
                />
                I reviewed this exact proposal, container, current image, target
                image and expiry.
              </label>
              <div className="toolbar">
                <button
                  disabled={!eligible || busy}
                  onClick={() => setConfirm("APPROVE")}
                >
                  Approve reviewed proposal
                </button>
                <button
                  disabled={!eligible || busy}
                  onClick={() => setConfirm("REJECT")}
                >
                  Reject reviewed proposal
                </button>
              </div>
            </>
          )}
          {user?.role !== "ADMIN" && (
            <p className="muted">
              Only a current ADMIN can decide this proposal. The backend
              enforces this permission.
            </p>
          )}
          <h3>Saved audit events</h3>
          <ol className="audit">
            {detail.data.events.map((event, i) => (
              <li key={String(event.sequence ?? i)}>
                <Badge value={text(event.status)} />{" "}
                <When value={text(event.created_at)} />
                <p className="small muted">
                  Actor: {String(event.actor_id ?? "Executor/system")}
                </p>
                {event.observations !== null && (
                  <pre className="raw" tabIndex={0}>
                    {JSON.stringify(event.observations, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ol>
          {detail.data.result != null && (
            <details>
              <summary>Recorded verification result</summary>
              <pre className="raw" tabIndex={0}>
                {JSON.stringify(detail.data.result, null, 2)}
              </pre>
            </details>
          )}
          <p className="small muted">
            Approval queues work for the separate executor. VERIFIED covers
            short sandbox probes only. FAILED/UNVERIFIED require inspection.
            Incident resolution remains a separate decision.
          </p>
        </>
      )}
      {confirm && detail.data && (
        <Confirmation
          title={
            confirm === "APPROVE"
              ? "Approve this exact sandbox rollback?"
              : "Reject this exact proposal?"
          }
          busy={busy}
          disabled={!eligible}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void decide()}
          label={
            confirm === "APPROVE"
              ? "Confirm sandbox approval"
              : "Confirm rejection"
          }
        >
          <p>
            Action <code>{detail.data.id}</code> · expires{" "}
            <When value={detail.data.expires_at} />
          </p>
          <BindingView value={detail.data.binding} />
          {!eligible && (
            <Notice>
              Review is stale or expired. Cancel and reload the proposal.
            </Notice>
          )}
        </Confirmation>
      )}
    </section>
  );
}
