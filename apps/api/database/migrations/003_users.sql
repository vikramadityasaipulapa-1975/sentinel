CREATE TABLE sentinel_api.users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
    password_hash text NOT NULL,
    role text NOT NULL CHECK (role IN ('VIEWER', 'OPERATOR', 'ADMIN')),
    enabled boolean NOT NULL DEFAULT true,
    token_version integer NOT NULL DEFAULT 0 CHECK (token_version >= 0),
    created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

-- Shared fixed-window counters contain HMAC keys, never raw emails or addresses.
CREATE TABLE sentinel_api.login_limits (
    key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
    attempts integer NOT NULL CHECK (attempts > 0),
    window_start timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX login_limits_window_start ON sentinel_api.login_limits (window_start);
