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

-- TODO: PK 이름 규칙(id vs 테이블_id)은 팀 회의 안건이다. 현재는 설계 문서의 이름을 따른다.
CREATE TABLE IF NOT EXISTS devices (
    device_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices (user_id);

CREATE TABLE IF NOT EXISTS folders (
    folder_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_name TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'disconnected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS folders_user_id_status_idx ON folders (user_id, status);

CREATE TABLE IF NOT EXISTS folder_locations (
    folder_id UUID NOT NULL REFERENCES folders(folder_id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    local_path TEXT NOT NULL,
    normalized_path TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ,
    PRIMARY KEY (folder_id, device_id),
    UNIQUE (device_id, normalized_path)
);

CREATE TABLE IF NOT EXISTS folder_exclusions (
    exclusion_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NOT NULL REFERENCES folders(folder_id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (folder_id, relative_path)
);

COMMIT;
