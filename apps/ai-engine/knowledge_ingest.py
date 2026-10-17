"""Explicit owner-run ingestion; never available as a public/LLM tool."""

from knowledge_catalog import load_catalog
from knowledge_chunks import chunk_document
from knowledge_database import connect


def ingest(dsn, embedder, root=None):
    documents = load_catalog(root) if root is not None else load_catalog()
    prepared = [(doc, chunk_document(doc)) for doc in documents]
    texts = [
        f"{doc.title}\n{chunk.section}\n{chunk.text}"
        for doc, chunks in prepared
        for chunk in chunks
    ]
    vectors = iter(embedder.embed(texts))
    inserted = 0
    with connect(dsn, readonly=False) as conn:
        conn.execute("SELECT pg_advisory_xact_lock(71627001)")
        models = conn.execute(
            "SELECT DISTINCT model_id FROM sentinel_knowledge.chunks"
        ).fetchall()
        if any(row["model_id"] != embedder.model_id for row in models):
            raise ValueError(
                "Embedding profile changed; prepare a separate reviewed index"
            )
        for doc, chunks in prepared:
            previous = conn.execute(
                "SELECT sha256,path,kind,title,services,categories FROM sentinel_knowledge.documents WHERE id=%s AND version=%s",
                (doc.id, doc.version),
            ).fetchone()
            if previous and previous != {
                "sha256": doc.sha256,
                "path": doc.path,
                "kind": doc.kind,
                "title": doc.title,
                "services": list(doc.services),
                "categories": list(doc.categories),
            }:
                raise ValueError("Published source changed without a new version")
            conn.execute(
                "INSERT INTO sentinel_knowledge.documents(id,version,path,kind,title,services,categories,body,sha256) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
                (
                    doc.id,
                    doc.version,
                    doc.path,
                    doc.kind,
                    doc.title,
                    list(doc.services),
                    list(doc.categories),
                    doc.content,
                    doc.sha256,
                ),
            )
            for chunk in chunks:
                vector = next(vectors)
                # The actual vector is validated by the embedding adapter and vector(384).
                added = conn.execute(
                    "INSERT INTO sentinel_knowledge.chunks(id,document_id,document_version,ordinal,section,start_offset,end_offset,body,sha256,model_id,embedding) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::vector) ON CONFLICT DO NOTHING RETURNING id",
                    (
                        chunk.id,
                        doc.id,
                        doc.version,
                        chunk.ordinal,
                        chunk.section,
                        chunk.start,
                        chunk.end,
                        chunk.text,
                        chunk.sha256,
                        embedder.model_id,
                        str(vector),
                    ),
                ).fetchone()
                inserted += added is not None
    return {
        "documents": len(documents),
        "inserted_chunks": inserted,
        "model_id": embedder.model_id,
    }
