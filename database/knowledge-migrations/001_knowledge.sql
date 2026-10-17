CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA sentinel_knowledge;
CREATE TABLE sentinel_knowledge.documents (
    id text NOT NULL CHECK (id ~ '^[a-z][a-z0-9-]{1,59}$'),
    version integer NOT NULL CHECK (version BETWEEN 1 AND 10000),
    path text NOT NULL CHECK (path ~ '^(runbooks|postmortems)/[a-z0-9-]+\.md$'),
    kind text NOT NULL CHECK (kind IN ('runbook','fictional-postmortem')),
    title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    services text[] NOT NULL,
    categories text[] NOT NULL,
    body text NOT NULL CHECK (octet_length(body)<=16384),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    PRIMARY KEY (id,version)
);
CREATE TABLE sentinel_knowledge.chunks (
    id text PRIMARY KEY CHECK (id ~ '^[0-9a-f]{64}$'),
    document_id text NOT NULL,
    document_version integer NOT NULL,
    ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 39),
    section text NOT NULL CHECK (length(section) BETWEEN 1 AND 100),
    start_offset integer NOT NULL CHECK (start_offset>=0),
    end_offset integer NOT NULL CHECK (end_offset>start_offset),
    body text NOT NULL CHECK (length(body)<=1400),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    model_id text NOT NULL CHECK (length(model_id) BETWEEN 1 AND 200),
    embedding vector(384) NOT NULL,
    FOREIGN KEY (document_id,document_version) REFERENCES sentinel_knowledge.documents(id,version),
    UNIQUE(document_id,document_version,ordinal,model_id)
);
CREATE INDEX knowledge_chunks_document ON sentinel_knowledge.chunks(document_id,document_version);
CREATE FUNCTION sentinel_knowledge.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Knowledge versions are append-only';
END $$;
CREATE TRIGGER knowledge_documents_immutable BEFORE UPDATE OR DELETE ON sentinel_knowledge.documents
FOR EACH ROW EXECUTE FUNCTION sentinel_knowledge.reject_mutation();
CREATE TRIGGER knowledge_chunks_immutable BEFORE UPDATE OR DELETE ON sentinel_knowledge.chunks
FOR EACH ROW EXECUTE FUNCTION sentinel_knowledge.reject_mutation();
