"""Read-only exact cosine retrieval with bounded source excerpts and provenance."""

import re

from knowledge_database import connect
from knowledge_embeddings import LocalEmbedder

QUERIES = {
    "dependency": "Payment upstream dependency timeout gateway errors and latency checks",
    "deployment": "Deployment release correlation error regression compare verified change timeline",
    "application": "Checkout application server errors validation and database failure checks",
    "load": "Traffic load surge request rate latency saturation checks",
    "telemetry": "Missing metrics logs traces telemetry coverage limits incident investigation",
}
DOMAIN = set(
    "payment upstream dependency timeout gateway latency deployment release regression checkout application server database traffic load surge saturation metrics logs traces telemetry coverage queue postgres".split()
)


def search(dsn, embedder, query, service, category):
    if (
        service not in {"checkout-service", "payment-service"}
        or category not in QUERIES
    ):
        raise ValueError("Invalid retrieval scope")
    if not isinstance(query, str) or not 1 <= len(query) <= 300:
        raise ValueError("Invalid retrieval query")
    # Similarity always has a nearest neighbour, even for irrelevant input.
    if len(set(re.findall(r"[a-z]+", query.lower())) & DOMAIN) < 2:
        return []
    vector = embedder.query(query)
    with connect(dsn) as conn:
        rows = conn.execute(
            """SELECT c.id AS chunk_id,c.document_id,c.document_version,c.ordinal,c.section,
            c.start_offset,c.end_offset,c.model_id,c.body AS passage,c.sha256 AS passage_sha256,
            d.path,d.kind,d.title,d.sha256 AS document_sha256,
            1-(c.embedding <=> %s::vector) AS similarity
            FROM sentinel_knowledge.chunks c JOIN sentinel_knowledge.documents d
            ON d.id=c.document_id AND d.version=c.document_version
            WHERE c.model_id=%s AND %s=ANY(d.services) AND %s=ANY(d.categories)
            AND NOT EXISTS (SELECT 1 FROM sentinel_knowledge.documents newer
              WHERE newer.id=d.id AND newer.version>d.version)
            ORDER BY c.embedding <=> %s::vector,c.id LIMIT 3""",
            (str(vector), embedder.model_id, service, category, str(vector)),
        ).fetchall()
    return [
        dict(row, similarity=round(float(row["similarity"]), 6))
        for row in rows
        if row["similarity"] >= 0.65
    ]


def context(status, citations=None):
    return {
        "version": 1,
        "status": status,
        "policy": "UNTRUSTED_GUIDANCE_ONLY",
        "citations": citations or [],
    }


def main():
    import json
    import os
    import sys

    request = json.loads(sys.stdin.buffer.read(1025))
    result = search(
        os.environ["SENTINEL_KNOWLEDGE_READ_URL"], LocalEmbedder(), **request
    )
    print(json.dumps(context("OK" if result else "EMPTY", result)))


if __name__ == "__main__":
    main()
