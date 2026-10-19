import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { array, record, text } from "../api/client";
import { runs, snapshots, type Snapshot } from "../api/evidence";
import { useSession } from "../auth/Session";
import { Badge, Notice, useLoad, When } from "./Common";
import { MetricCharts } from "./MetricChart";
function Json({ value }: { value: unknown }) {
  return (
    <pre className="raw" tabIndex={0}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
function SnapshotCard({ item }: { item: Snapshot }) {
  return (
    <section className="panel" id={`snapshot-${item.id}`}>
      <div className="section-heading">
        <h3>{item.source}</h3>
        <Badge value={item.status} />
      </div>
      <p className="small muted">
        Saved window: <When value={item.window.start} /> —{" "}
        <When value={item.window.end} />
      </p>
      <p className="small muted">
        Collected <When value={item.collected} /> · {item.window.service}
      </p>
      {item.source === "prometheus" && (
        <>
          <MetricCharts
            data={item.data}
            start={item.window.start}
            end={item.window.end}
          />
          <p className="small muted">
            Saved query results; not a live feed. Gaps stay disconnected. p95
            values are pointwise estimates.
          </p>
        </>
      )}
      {item.source === "loki" && (
        <>
          <p>
            {String(item.data.retrieved_count ?? 0)} retrieved records ·{" "}
            {item.data.truncated
              ? "Result limit reached"
              : "Within retrieval limit"}
          </p>
          <p className="small muted">
            Counts describe retrieved records only. Samples below may be a
            smaller subset.
          </p>
          {Array.isArray(item.data.samples) && (
            <div className="log-samples">
              {item.data.samples.map((row, i) => (
                <Json key={i} value={row} />
              ))}
            </div>
          )}
        </>
      )}
      {item.source === "deployments" && (
        <>
          {item.status === "EMPTY" ? (
            <p className="muted">
              No matching recorded deployments in this window.
            </p>
          ) : item.status === "UNAVAILABLE" ? (
            <Notice>
              Deployment history could not be collected. This does not prove
              there were no releases.
            </Notice>
          ) : (
            <Json value={item.data} />
          )}
        </>
      )}
      {item.source === "calculations" && (
        <>
          <p className="small muted">
            {String(
              item.data.meaning ??
                "Descriptive comparisons only; not causal proof.",
            )}
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Scrollable evidence table"
          >
            <table>
              <caption>Adjacent-window descriptive comparisons</caption>
              <thead>
                <tr>
                  <th>Measurement</th>
                  <th>Before</th>
                  <th>After</th>
                  <th>Change</th>
                  <th>Coverage/status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(record(item.data.comparisons ?? {})).map(
                  ([key, value]) => {
                    const r = record(value);
                    const scale = key === "error_ratio" ? 100 : 1;
                    const format = (v: unknown) =>
                      typeof v === "number" && Number.isFinite(v)
                        ? Number((v * scale).toPrecision(5)).toString()
                        : "Unavailable";
                    return (
                      <tr key={key}>
                        <th>
                          {key.replaceAll("_", " ")}
                          {key === "error_ratio"
                            ? " (%)"
                            : key === "p95_seconds"
                              ? " (seconds)"
                              : " (requests/s)"}
                        </th>
                        <td>{format(r.before_mean)}</td>
                        <td>{format(r.after_mean)}</td>
                        <td>{format(r.absolute_delta)}</td>
                        <td>
                          {String(r.status).replaceAll("_", " ")}
                          {r.relative_reason
                            ? ` · ${String(r.relative_reason).replaceAll("_", " ")}`
                            : ""}
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <details>
        <summary>Evidence provenance and query</summary>
        <dl className="provenance">
          <dt>Snapshot ID</dt>
          <dd>
            <code>{item.id}</code>
          </dd>
          <dt>SHA-256 · server verified</dt>
          <dd>
            <code>{item.hash}</code>
          </dd>
        </dl>
        <Json value={item.locator} />
      </details>
    </section>
  );
}
function Report({ value }: { value: unknown }) {
  const envelope = record(value);
  if (envelope.hash_verified !== true)
    throw new Error("Report integrity not verified");
  const report = record(envelope.report),
    knowledge = envelope.knowledge === null ? null : record(envelope.knowledge);
  return (
    <section className="panel">
      <p className="eyebrow">SAVED ANALYSIS</p>
      <h2>{text(report.conclusion).replaceAll("_", " ")}</h2>
      <div className="toolbar">
        <Badge value={text(report.status)} />
        <Badge value={text(report.model_status)} />
        <span className="small muted">
          {report.ai_performed === true
            ? "Model-assisted hypotheses"
            : "Deterministic analysis · no chat model inference"}
        </span>
      </div>
      <p className="muted">
        Hypotheses are suggestions, not confirmed causes. Citation validity is
        not confidence.
      </p>
      <h3>Limitations</h3>
      <ul>
        {array(report.limitations).map((x, i) => (
          <li key={i}>{text(x).replaceAll("_", " ")}</li>
        ))}
      </ul>
      <h3>Hypotheses</h3>
      {!array(report.hypotheses).length ? (
        <p className="muted">No supported hypothesis was produced.</p>
      ) : (
        array(report.hypotheses).map((value, i) => {
          const h = record(value);
          return (
            <article className="hypothesis" key={i}>
              <h3>{String(h.title ?? h.category ?? "Hypothesis")}</h3>
              <p className="small muted">
                Rank {String(h.rank)} · uncertainty: {String(h.uncertainty)}{" "}
                (not a calibrated probability)
              </p>
              <p>
                Supporting facts:{" "}
                {array(h.supporting_fact_ids ?? []).map((id, i) => (
                  <span key={i}>
                    <a href={`#fact-${text(id)}`}>{text(id)}</a>
                    {i < array(h.supporting_fact_ids ?? []).length - 1
                      ? ", "
                      : ""}
                  </span>
                ))}
              </p>
              <p className="small muted">
                Contradicting facts:{" "}
                {array(h.contradicting_fact_ids ?? [])
                  .map(text)
                  .join(", ") ||
                  "None cited; this does not prove there are none."}
              </p>
            </article>
          );
        })
      )}
      <h3>Referenced facts</h3>
      <ul>
        {array(report.facts).map((value, i) => {
          const fact = record(value);
          return (
            <li key={i} id={`fact-${text(fact.id)}`}>
              <a href={`#snapshot-${text(fact.snapshot_id)}`}>
                {text(fact.id)}
              </a>
              : {String(fact.value)}{" "}
              <span className="small muted">{String(fact.pointer)}</span>
            </li>
          );
        })}
      </ul>
      <h3>Knowledge guidance</h3>
      {knowledge ? (
        <>
          <Badge value={text(knowledge.status)} />
          <p className="small muted">
            Untrusted guidance only. Similarity measures relevance, not
            probability of a cause.
          </p>
          {array(knowledge.citations ?? []).map((value, i) => {
            const c = record(value);
            return (
              <details key={i}>
                <summary>
                  {text(c.title)} · {text(c.section)}
                </summary>
                <p className="citation">{text(c.passage)}</p>
                <p className="small muted">
                  {text(c.path)} · version {String(c.document_version)} ·
                  offsets {String(c.start_offset)}–{String(c.end_offset)}
                </p>
                <code className="hash">{text(c.passage_sha256)}</code>
              </details>
            );
          })}
        </>
      ) : (
        <p className="muted">No saved knowledge context.</p>
      )}
      <details>
        <summary>Report integrity</summary>
        <code className="hash">{text(envelope.sha256)}</code>
        <p className="small muted">
          Verified by the backend; a hash is an integrity check, not proof of
          truth.
        </p>
      </details>
    </section>
  );
}
function EvidenceView({ id }: { id: string }) {
  const { api, token } = useSession();
  const [cursor, setCursor] = useState(""),
    [saved, setSaved] = useState<Snapshot[]>([]);
  const state = useLoad(
    async (signal) =>
      snapshots(
        await api(
          `/api/v1/investigations/${id}/evidence?limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          {},
          signal,
        ),
      ),
    [token, id, cursor],
  );
  const report = useLoad(
    async (signal) => {
      const value = await api(
        `/api/v1/investigations/${id}/report`,
        {},
        signal,
      );
      const row = record(value);
      record(row.report);
      return value;
    },
    [token, id],
  );
  useEffect(() => {
    if (state.data)
      setSaved((old) => {
        const map = new Map(old.map((x) => [x.id, x]));
        for (const item of state.data!.items) map.set(item.id, item);
        return [...map.values()];
      });
  }, [state.data]);
  return (
    <>
      <div className="section-heading">
        <h2>Saved evidence & report</h2>
        <button
          onClick={() => {
            state.refresh();
            report.refresh();
          }}
        >
          Refresh saved results
        </button>
      </div>
      <p className="small muted">
        Investigation <code>{id}</code>
      </p>
      {report.loading && <p role="status">Loading report…</p>}
      {report.error && (
        <Notice>
          Report unavailable: {report.error} A queued run or older investigation
          may not have one yet.
        </Notice>
      )}
      {report.data && <Report value={report.data} />}
      <h2>Source snapshots</h2>
      {state.loading && <p role="status">Loading evidence…</p>}
      {state.error && <Notice>{state.error}</Notice>}
      {saved.map((item) => (
        <SnapshotCard key={item.id} item={item} />
      ))}
      {!state.loading && !state.error && !saved.length && (
        <p className="muted">No evidence saved yet.</p>
      )}
      {state.data?.next && (
        <button onClick={() => setCursor(state.data!.next!)}>
          More evidence
        </button>
      )}
    </>
  );
}
export function EvidenceWorkspace({
  incidentId,
  revision = 0,
}: {
  incidentId: string;
  revision?: number;
}) {
  const { api, token } = useSession();
  const [params, setParams] = useSearchParams();
  const [cursor, setCursor] = useState("");
  const state = useLoad(
    async (signal) =>
      runs(
        await api(
          `/api/v1/incidents/${incidentId}/investigations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          {},
          signal,
        ),
      ),
    [token, incidentId, cursor, revision],
  );
  const selected =
    params.get("investigation") ?? state.data?.items[0]?.id ?? "";
  return (
    <section aria-label="Investigation evidence">
      <div className="section-heading">
        <h2>Investigations</h2>
        <button onClick={state.refresh}>Refresh investigations</button>
      </div>
      {state.loading && <p role="status">Loading investigations…</p>}
      {state.error && <Notice>{state.error}</Notice>}
      {state.data && (
        <>
          {state.data.items.length > 0 ? (
            <label className="run-picker">
              Saved investigation
              <select
                value={selected}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  next.set("investigation", e.target.value);
                  setParams(next);
                }}
              >
                {selected &&
                  !state.data.items.some((x) => x.id === selected) && (
                    <option value={selected}>{selected}</option>
                  )}
                {state.data.items.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.status} · {new Date(row.created_at).toLocaleString()} ·{" "}
                    {row.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="panel muted">
              No investigations yet. Start one to collect evidence for this
              incident.
            </p>
          )}
          <div className="toolbar">
            {cursor && (
              <button onClick={() => setCursor("")}>
                Newest investigations
              </button>
            )}
            {state.data.next && (
              <button onClick={() => setCursor(state.data!.next!)}>
                Older investigations
              </button>
            )}
          </div>
        </>
      )}
      {selected && <EvidenceView key={selected} id={selected} />}
    </section>
  );
}
