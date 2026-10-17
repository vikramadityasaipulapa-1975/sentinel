import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hash, canonical } from "../src/evidence.js";
export function knowledgeFixture(id = "payment-timeout") {
  const root = fileURLToPath(
    new URL("../../../../knowledge/", import.meta.url),
  );
  const doc = JSON.parse(readFileSync(root + "manifest.json", "utf8")).find(
    (row: { id: string }) => row.id === id,
  );
  const content = readFileSync(root + doc.path, "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const heading = /^## Scope$/m.exec(content)!;
  const start = heading.index + heading[0].length + 1;
  const end = content.indexOf("## Symptoms", start);
  const passage = content.slice(start, end);
  const profile = JSON.parse(
    readFileSync(root + "embedding-model.json", "utf8"),
  );
  return {
    version: 1,
    status: "OK",
    policy: "UNTRUSTED_GUIDANCE_ONLY",
    citations: [
      {
        chunk_id: hash(`${doc.id}:${doc.version}:0:${hash(passage)}`),
        document_id: doc.id,
        document_version: doc.version,
        ordinal: 0,
        section: "Scope",
        start_offset: start,
        end_offset: end,
        passage,
        passage_sha256: hash(passage),
        path: doc.path,
        kind: doc.kind,
        title: content.split("\n")[0].slice(2),
        document_sha256: hash(content),
        similarity: 0.75,
        model_id: profile.model + "@" + hash(canonical(profile)),
      },
    ],
  };
}
