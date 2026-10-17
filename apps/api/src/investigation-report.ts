import type { PoolClient } from "pg";
import { canonical, hash, readSnapshot, type Evidence } from "./evidence.js";
import { IncidentError, unavailable } from "./incidents.js";

const titles: Record<string, string> = {
  deployment: "Possible deployment-related regression",
  dependency: "Possible dependency failure or latency",
  load: "Possible load-related degradation",
  application: "Possible application error",
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function exact(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    throw new Error("Invalid report object");
}
function strings(value: unknown, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((v) => typeof v === "string" && v.length <= 100) &&
    new Set(value).size === value.length
  );
}
export function resolvePointer(evidence: Evidence, pointer: string): unknown {
  if (!/^\/data\/[a-zA-Z0-9_/-]{1,190}$/.test(pointer))
    throw new Error("Invalid fact pointer");
  let current: unknown = evidence;
  for (const key of pointer.slice(1).split("/")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key))
      throw new Error("Missing cited value");
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
export function validateReport(input: unknown, evidence: Evidence[]) {
  if (Buffer.byteLength(canonical(input)) > 65536)
    throw new Error("Report too large");
  exact(input, [
    "version",
    "mode",
    "model_status",
    "model_name",
    "ai_performed",
    "status",
    "conclusion",
    "hypotheses",
    "facts",
    "limitations",
  ]);
  if (
    input.version !== 1 ||
    !["deterministic", "model-assisted"].includes(String(input.mode)) ||
    !["OK", "DISABLED", "INVALID", "UNAVAILABLE", "TIMEOUT"].includes(
      String(input.model_status),
    ) ||
    !(
      input.model_name === null ||
      (typeof input.model_name === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,99}$/.test(input.model_name))
    ) ||
    typeof input.ai_performed !== "boolean" ||
    input.ai_performed !== (input.mode === "model-assisted") ||
    (input.ai_performed && input.model_status !== "OK") ||
    !["PARTIAL", "COMPLETED"].includes(String(input.status)) ||
    !["HYPOTHESES_ONLY", "INSUFFICIENT_EVIDENCE"].includes(
      String(input.conclusion),
    ) ||
    !Array.isArray(input.facts) ||
    input.facts.length > 40 ||
    !Array.isArray(input.hypotheses) ||
    input.hypotheses.length > 3 ||
    !strings(input.limitations, 20) ||
    input.limitations.some((v) => !/^[A-Z_]{1,80}$/.test(v))
  )
    throw new Error("Invalid report contract");
  const facts = new Map<
    string,
    { source: string; pointer: string; value: number }
  >();
  for (const fact of input.facts) {
    exact(fact, ["id", "source", "pointer", "value"]);
    const source = evidence.find((row) => row.source === fact.source);
    if (
      typeof fact.id !== "string" ||
      !/^[a-z][a-z0-9_.]{0,79}$/.test(fact.id) ||
      facts.has(fact.id) ||
      !source ||
      !["OK", "PARTIAL"].includes(source.status) ||
      typeof fact.pointer !== "string" ||
      typeof fact.value !== "number" ||
      !Number.isFinite(fact.value) ||
      resolvePointer(source, fact.pointer) !== fact.value
    )
      throw new Error("Invalid evidence fact");
    const metric = /^metrics\.(error|latency|rate)_(before|after|delta)$/.exec(
      fact.id,
    );
    const metricNames: Record<string, string> = {
      error: "error_ratio",
      latency: "p95_seconds",
      rate: "request_rate",
    };
    const fields: Record<string, string> = {
      before: "before_mean",
      after: "after_mean",
      delta: "absolute_delta",
    };
    const expected = metric
      ? [
          "calculations",
          `/data/comparisons/${metricNames[metric[1]]}/${fields[metric[2]]}`,
        ]
      : fact.id === "deployments.verified"
        ? ["deployments", "/data/verified_release_count"]
        : fact.id === "logs.retrieved"
          ? ["loki", "/data/retrieved_count"]
          : /^logs\.http_(500|502|503|504)$/.test(fact.id)
            ? ["loki", `/data/counts_by_status/${fact.id.slice(-3)}`]
            : null;
    if (
      !expected ||
      expected[0] !== fact.source ||
      expected[1] !== fact.pointer
    )
      throw new Error("Mislabeled evidence fact");
    facts.set(fact.id, {
      source: source.source,
      pointer: fact.pointer,
      value: fact.value,
    });
  }
  const value = (id: string) => facts.get(id)?.value ?? 0;
  const eligible: Record<string, string[]> = {};
  if (value("deployments.verified") > 0 && value("metrics.error_delta") > 0.05)
    eligible.deployment = ["deployments.verified", "metrics.error_delta"];
  const dependency = ["logs.http_502", "logs.http_504"].filter(
    (id) => value(id) > 0,
  );
  if (dependency.length) eligible.dependency = dependency;
  if (
    value("metrics.rate_before") > 0 &&
    value("metrics.rate_after") >= 2 * value("metrics.rate_before") &&
    value("metrics.latency_delta") > 0.1
  )
    eligible.load = [
      "metrics.rate_before",
      "metrics.rate_after",
      "metrics.latency_delta",
    ];
  if (value("metrics.error_after") >= 0.05 || value("logs.http_500") > 0)
    eligible.application =
      value("metrics.error_after") >= 0.05
        ? ["metrics.error_after"]
        : ["logs.http_500"];
  const categories = new Set();
  for (const [index, item] of input.hypotheses.entries()) {
    exact(item, [
      "rank",
      "category",
      "title",
      "supporting_fact_ids",
      "contradicting_fact_ids",
      "uncertainty",
      "certainty",
    ]);
    if (
      typeof item.category !== "string" ||
      !Object.hasOwn(eligible, item.category) ||
      categories.has(item.category) ||
      item.rank !== index + 1 ||
      item.title !== titles[item.category] ||
      item.certainty !== "hypothesis" ||
      item.uncertainty !== "high" ||
      !strings(item.supporting_fact_ids, 6) ||
      !strings(item.contradicting_fact_ids, 6) ||
      [...item.supporting_fact_ids].sort().join() !==
        [...eligible[item.category]].sort().join() ||
      item.contradicting_fact_ids.some(
        (id) =>
          !facts.has(id) || (item.supporting_fact_ids as string[]).includes(id),
      )
    )
      throw new Error("Invalid hypothesis citation");
    categories.add(item.category);
  }
  if (
    (input.conclusion === "HYPOTHESES_ONLY") !== !!input.hypotheses.length ||
    ((!input.hypotheses.length ||
      evidence.some((row) => row.status !== "OK") ||
      !["OK", "DISABLED"].includes(String(input.model_status))) &&
      input.status !== "PARTIAL")
  )
    throw new Error("Invalid report completion");
  return input;
}
export async function insertReport(
  client: PoolClient,
  id: string,
  attempt: number,
  input: unknown,
  evidence: Evidence[],
) {
  const report = validateReport(input, evidence);
  const snapshots = (
    await client.query(
      "SELECT id,source,sha256 FROM sentinel_api.evidence_snapshots WHERE investigation_id=$1 AND attempt=$2",
      [id, attempt],
    )
  ).rows;
  if (snapshots.length !== 4) throw new Error("Missing report snapshots");
  const bound = {
    ...report,
    facts: (report.facts as Record<string, unknown>[]).map((fact) => {
      const snapshot = snapshots.find((row) => row.source === fact.source);
      if (!snapshot) throw new Error("Missing citation source");
      return {
        ...fact,
        snapshot_id: snapshot.id,
        snapshot_sha256: snapshot.sha256,
      };
    }),
  };
  const text = canonical(bound);
  await client.query(
    "INSERT INTO sentinel_api.investigation_reports(investigation_id,attempt,report_json,canonical_json,sha256) VALUES ($1,$2,$3::text::jsonb,$3::text,$4)",
    [id, attempt, text, hash(text)],
  );
}
export async function readReport(client: PoolClient, id: string) {
  const row = (
    await client.query(
      "SELECT * FROM sentinel_api.investigation_reports WHERE investigation_id=$1",
      [id],
    )
  ).rows[0];
  if (!row)
    throw new IncidentError(
      404,
      "REPORT_NOT_FOUND",
      "No report saved for this investigation",
    );
  if (
    typeof row.canonical_json !== "string" ||
    hash(row.canonical_json) !== row.sha256 ||
    canonical(row.report_json) !== row.canonical_json
  )
    throw unavailable();
  const snapshots = (
    await client.query(
      "SELECT * FROM sentinel_api.evidence_snapshots WHERE investigation_id=$1 AND attempt=$2",
      [id, row.attempt],
    )
  ).rows;
  for (const snapshot of snapshots) readSnapshot(snapshot);
  for (const fact of row.report_json.facts) {
    const snapshot = snapshots.find(
      (s) =>
        s.id === fact.snapshot_id &&
        s.source === fact.source &&
        s.sha256 === fact.snapshot_sha256,
    );
    if (
      !snapshot ||
      resolvePointer(snapshot.payload_json, fact.pointer) !== fact.value
    )
      throw unavailable();
  }
  return {
    investigation_id: id,
    attempt: row.attempt,
    hash_verified: true,
    sha256: row.sha256,
    report: row.report_json,
  };
}
