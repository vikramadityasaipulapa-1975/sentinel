CREATE TABLE sentinel_api.services (
    id uuid PRIMARY KEY,
    name text NOT NULL UNIQUE CHECK (name ~ '^[a-z][a-z0-9-]{0,62}$'),
    owner text NOT NULL CHECK (length(owner) BETWEEN 1 AND 100),
    environment text NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
    created_at timestamptz NOT NULL DEFAULT now()
);
