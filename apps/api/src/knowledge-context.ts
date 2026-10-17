import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonical, hash } from "./evidence.js";

const root = fileURLToPath(new URL("../../../../knowledge/", import.meta.url));
const keys = (
  value: unknown,
  expected: string[],
): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === expected.sort().join();
export function validateKnowledge(
  input: unknown,
  service: string,
  category?: string,
) {
  if (
    !keys(input, ["version", "status", "policy", "citations"]) ||
    input.version !== 1 ||
    input.policy !== "UNTRUSTED_GUIDANCE_ONLY" ||
    !["OK", "EMPTY", "DISABLED", "UNAVAILABLE"].includes(
      String(input.status),
    ) ||
    !Array.isArray(input.citations) ||
    input.citations.length > 3 ||
    (input.status === "OK") !== input.citations.length > 0 ||
    Buffer.byteLength(canonical(input)) > 16384
  )
    throw new Error("Invalid knowledge context");
  if (!input.citations.length) return input;
  const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
  const profile = JSON.parse(
    readFileSync(root + "embedding-model.json", "utf8"),
  );
  const model = profile.model + "@" + hash(canonical(profile));
  const seen = new Set();
  for (const citation of input.citations) {
    if (
      !keys(citation, [
        "chunk_id",
        "document_id",
        "document_version",
        "ordinal",
        "section",
        "start_offset",
        "end_offset",
        "passage",
        "passage_sha256",
        "path",
        "kind",
        "title",
        "document_sha256",
        "similarity",
        "model_id",
      ])
    )
      throw new Error("Invalid knowledge citation");
    const doc = manifest.find(
      (d: Record<string, unknown>) =>
        d.id === citation.document_id &&
        d.version === citation.document_version,
    );
    if (
      !doc ||
      !/^(runbooks|postmortems)\/[a-z0-9-]+\.md$/.test(doc.path) ||
      !doc.services.includes(service) ||
      (category && !doc.categories.includes(category)) ||
      citation.path !== doc.path ||
      citation.kind !== doc.kind ||
      citation.model_id !== model ||
      typeof citation.similarity !== "number" ||
      !Number.isFinite(citation.similarity) ||
      citation.similarity < 0.65 ||
      citation.similarity > 1 ||
      !Number.isInteger(citation.ordinal) ||
      Number(citation.ordinal) < 0 ||
      Number(citation.ordinal) >= 40 ||
      !Number.isInteger(citation.start_offset) ||
      !Number.isInteger(citation.end_offset) ||
      typeof citation.passage !== "string" ||
      citation.passage.length > 2800 ||
      typeof citation.section !== "string" ||
      seen.has(citation.chunk_id)
    )
      throw new Error("Unknown or out-of-scope source");
    const content = readFileSync(root + doc.path, "utf8").replaceAll(
      "\r\n",
      "\n",
    );
    // Python offsets count Unicode code points, so do not use JS UTF-16 slice here.
    const chars = Array.from(content);
    const start = Number(citation.start_offset),
      end = Number(citation.end_offset);
    if (
      start < 0 ||
      end <= start ||
      end > chars.length ||
      end - start > 1400 ||
      chars.slice(start, end).join("") !== citation.passage ||
      hash(citation.passage) !== citation.passage_sha256 ||
      hash(content) !== citation.document_sha256 ||
      content.split("\n")[0].slice(2) !== citation.title ||
      ![
        "Scope",
        "Symptoms",
        "Possible causes",
        "Checks",
        "Remediation guidance",
        "Limitations",
      ].includes(citation.section) ||
      hash(
        `${doc.id}:${doc.version}:${citation.ordinal}:${citation.passage_sha256}`,
      ) !== citation.chunk_id
    )
      throw new Error("Citation text or hash mismatch");
    // The cited range must lie in the declared section, not merely elsewhere in the file.
    const passages: { start: number; end: number; section: string }[] = [];
    // Match the ingestion split rule independently against reviewed source text.
    const source = chars.join("");
    const headingsWithOffsets = [...source.matchAll(/^## (.+)$/gm)].map(
      (h) => ({
        section: h[1],
        start: Array.from(source.slice(0, h.index!)).length,
        end: Array.from(source.slice(0, h.index! + h[0].length)).length,
      }),
    );
    for (const [index, heading] of headingsWithOffsets.entries()) {
      let at = heading.end + 1;
      const limit = headingsWithOffsets[index + 1]?.start ?? chars.length;
      while (at < limit) {
        let stop = Math.min(at + 1400, limit);
        if (stop < limit) {
          for (let boundary = stop - 1; boundary >= at + 700; boundary--)
            if (chars[boundary] === " ") {
              stop = boundary;
              break;
            }
        }
        if (chars.slice(at, stop).join("").trim())
          passages.push({ start: at, end: stop, section: heading.section });
        at = stop;
      }
    }
    const expected = passages[Number(citation.ordinal)];
    if (
      !expected ||
      expected.start !== start ||
      expected.end !== end ||
      expected.section !== citation.section
    )
      throw new Error("Citation is not an ingested passage");
    const before = chars.slice(0, start).join("");
    const headings = [...before.matchAll(/^## (.+)$/gm)];
    if (
      headings.at(-1)?.[1] !== citation.section ||
      citation.passage.includes("\n## ")
    )
      throw new Error("Citation section mismatch");
    seen.add(citation.chunk_id);
  }
  return input;
}
