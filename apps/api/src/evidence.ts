import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { unavailable } from "./incidents.js";

export const sources = [
  "prometheus",
  "loki",
  "deployments",
  "calculations",
] as const;
export interface Evidence {
  source: string;
  status: string;
  window: { service: string; start: string; end: string };
  collected_at: string;
  locator: Record<string, unknown>;
  data: Record<string, unknown>;
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function canonical(value: unknown): string {
  let count = 0;
  function normalize(input: unknown, depth: number): unknown {
    if (++count > 10000 || depth > 12)
      throw new Error("Evidence exceeds limits");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input === "string" && input.length <= 4096) return input;
    if (Array.isArray(input)) return input.map((v) => normalize(v, depth + 1));
    if (object(input))
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => {
            if (
              key.length > 100 ||
              ["__proto__", "constructor", "prototype"].includes(key)
            )
              throw new Error("Invalid evidence key");
            return [key, normalize(input[key], depth + 1)];
          }),
      );
    throw new Error("Invalid evidence value");
  }
  const text = JSON.stringify(normalize(value, 0));
  if (Buffer.byteLength(text) > 131072) throw new Error("Evidence too large");
  return text;
}
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function validateEvidence(
  value: unknown,
  service?: string,
  start?: string,
  end?: string,
): Evidence[] {
  if (!Array.isArray(value) || value.length !== 4)
    throw new Error("Expected four evidence sources");
  canonical(value);
  const seen = new Set();
  for (const row of value) {
    if (
      !object(row) ||
      !sources.includes(row.source as (typeof sources)[number]) ||
      seen.has(row.source) ||
      !["OK", "EMPTY", "UNAVAILABLE", "INVALID", "PARTIAL", "STALE"].includes(
        String(row.status),
      ) ||
      !object(row.window) ||
      !["checkout-service", "payment-service"].includes(
        String(row.window.service),
      ) ||
      !object(row.locator) ||
      !object(row.data) ||
      typeof row.collected_at !== "string" ||
      !Number.isFinite(Date.parse(row.collected_at)) ||
      Date.parse(row.collected_at) > Date.now() + 5000 ||
      typeof row.window.start !== "string" ||
      typeof row.window.end !== "string"
    )
      throw new Error("Invalid evidence contract");
    const from = Date.parse(row.window.start),
      to = Date.parse(row.window.end);
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      to <= from ||
      to - from > 1800000 ||
      to > Date.now() + 5000 ||
      (service && row.window.service !== service) ||
      (start && from !== Date.parse(start)) ||
      (end && to !== Date.parse(end))
    )
      throw new Error("Evidence window mismatch");
    seen.add(row.source);
  }
  const first = value[0].window;
  if (
    value.some(
      (row) =>
        row.window.service !== first.service ||
        Date.parse(row.window.start) !== Date.parse(first.start) ||
        Date.parse(row.window.end) !== Date.parse(first.end),
    )
  )
    throw new Error("Source windows differ");
  return value as Evidence[];
}
export async function insertEvidence(
  client: PoolClient,
  investigation: string,
  attempt: number,
  evidence: Evidence[],
) {
  for (const row of evidence) {
    const text = canonical(row);
    // Infer the shared parameter as text first: JSONB output would reformat canonical bytes.
    await client.query(
      "INSERT INTO sentinel_api.evidence_snapshots(id,investigation_id,attempt,source,status,collected_at,window_start,window_end,payload_json,canonical_json,sha256) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,$9::text,$10)",
      [
        randomUUID(),
        investigation,
        attempt,
        row.source,
        row.status,
        row.collected_at,
        row.window.start,
        row.window.end,
        text,
        hash(text),
      ],
    );
  }
}
export function readSnapshot(row: Record<string, unknown>) {
  if (
    typeof row.canonical_json !== "string" ||
    hash(row.canonical_json) !== row.sha256 ||
    canonical(row.payload_json) !== row.canonical_json
  )
    throw unavailable();
  return {
    id: row.id,
    investigation_id: row.investigation_id,
    attempt: row.attempt,
    source: row.source,
    sha256: row.sha256,
    hash_algorithm: "sha256/sorted-json-v1",
    hash_verified: true,
    evidence: row.payload_json,
  };
}
export function evidenceConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!env.SENTINEL_EVIDENCE_URL && !env.SENTINEL_EVIDENCE_SECRET) return null;
  const url = new URL(env.SENTINEL_EVIDENCE_URL ?? "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol === "http:" &&
      !["127.0.0.1", "localhost"].includes(url.hostname)) ||
    !/^[a-f0-9]{64,128}$/.test(env.SENTINEL_EVIDENCE_SECRET ?? "")
  )
    throw new Error("Invalid evidence configuration");
  return {
    url: new URL("/collect", url).href,
    secret: env.SENTINEL_EVIDENCE_SECRET!,
  };
}
export async function collectInvestigation(
  config: NonNullable<ReturnType<typeof evidenceConfig>>,
  service: string,
  start: string,
  end: string,
) {
  const response = await fetch(config.url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(14000),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.secret}`,
    },
    body: JSON.stringify({ service, start, end }),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("Collector unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 131072) throw new Error("Collector response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    body.mode !== "deterministic-evidence" ||
    typeof body.ai_performed !== "boolean"
  )
    throw new Error("Invalid collector response");
  const evidence = validateEvidence(body.evidence, service, start, end);
  const { validateReport } = await import("./investigation-report.js");
  const analysis =
    body.analysis === undefined
      ? undefined
      : validateReport(body.analysis, evidence);
  if ((analysis?.ai_performed ?? false) !== body.ai_performed)
    throw new Error("Inconsistent AI status");
  return { evidence, analysis };
}

export async function collectEvidence(
  config: NonNullable<ReturnType<typeof evidenceConfig>>,
  service: string,
  start: string,
  end: string,
) {
  return (await collectInvestigation(config, service, start, end)).evidence;
}
