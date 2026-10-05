CREATE TABLE refresh_tokens (
    token_hash char(64)    PRIMARY KEY,
    user_id    bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);
