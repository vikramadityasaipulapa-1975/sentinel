CREATE TABLE demo_versions (
    version text PRIMARY KEY,
    service text NOT NULL CHECK (service = 'payment-service'),
    source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
    commit_sha text CHECK (commit_sha ~ '^[0-9a-f]{40}$'),
    image_id text CHECK (image_id ~ '^sha256:[0-9a-f]{64}$'),
    configuration jsonb NOT NULL,
    registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE demo_deployments (
    id uuid PRIMARY KEY,
    service text NOT NULL CHECK (service = 'payment-service'),
    version text NOT NULL REFERENCES demo_versions(version),
    backend text NOT NULL CHECK (backend IN ('native', 'compose')),
    status text NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'SUPERSEDED', 'FAILED')),
    deployed_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    finished_at timestamptz
);

CREATE UNIQUE INDEX demo_deployments_one_active ON demo_deployments(service) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX demo_deployments_one_pending ON demo_deployments(service) WHERE status = 'PENDING';
CREATE INDEX demo_deployments_service_time ON demo_deployments(service, deployed_at DESC);
