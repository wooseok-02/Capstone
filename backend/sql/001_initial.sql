BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider VARCHAR(20) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    nickname VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS refresh_token (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS refresh_token_user_id_idx ON refresh_token (user_id);

CREATE TABLE IF NOT EXISTS used_refresh_tokens (
    token_hash VARCHAR(64) PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES refresh_token(id) ON DELETE CASCADE,
    used_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS used_refresh_tokens_session_id_idx ON used_refresh_tokens (session_id);

CREATE TABLE IF NOT EXISTS desktop_login_codes (
    code_hash VARCHAR(64) PRIMARY KEY,
    code_challenge VARCHAR(43) NOT NULL,
    provider VARCHAR(20) NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    nickname VARCHAR(50),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS desktop_login_codes_expires_at_idx ON desktop_login_codes (expires_at);

COMMIT;
