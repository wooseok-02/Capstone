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

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NOT NULL REFERENCES folders(folder_id) ON DELETE CASCADE,
    -- 폴더 루트 기준 경로. 구분자는 `/`, Unicode는 NFC로 저장한다.
    -- TODO: 파일 이동·이름 변경 시 같은 문서로 볼지는 팀 확정 후 정한다.
    relative_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    registered_device_id UUID REFERENCES devices(device_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (folder_id, relative_path)
);

CREATE TABLE IF NOT EXISTS document_versions (
    document_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    version_no INT NOT NULL CHECK (version_no > 0),
    -- R2 저장 위치만 저장한다. 서명 URL은 저장하지 않는다.
    object_key TEXT NOT NULL UNIQUE,
    file_size BIGINT NOT NULL CHECK (file_size >= 0),
    sha256 CHAR(64) NOT NULL,
    mime_type TEXT NOT NULL,
    file_modified_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'upload_pending' CHECK (status IN (
        'registered', 'upload_pending', 'uploaded', 'processing', 'ready',
        'upload_failed', 'processing_failed'
    )),
    error_code TEXT,
    embedding_model TEXT,
    embedding_dim INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uploaded_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    UNIQUE (document_id, version_no)
);

CREATE INDEX IF NOT EXISTS document_versions_status_idx ON document_versions (document_id, status);

CREATE TABLE IF NOT EXISTS document_locations (
    document_id UUID NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    local_path TEXT NOT NULL,
    version_no INT,
    sha256 CHAR(64),
    last_verified_at TIMESTAMPTZ,
    PRIMARY KEY (document_id, device_id)
);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_version_id UUID NOT NULL REFERENCES document_versions(document_version_id) ON DELETE CASCADE,
    chunk_index INT NOT NULL CHECK (chunk_index >= 0),
    chunk_text TEXT NOT NULL,
    -- TODO: 임베딩 모델·차원이 확정되면 vector(N)으로 고정하고 HNSW 등 검색 인덱스를 추가한다.
    -- 지금은 차원을 고정하지 않고, 버전별 embedding_model·embedding_dim으로 검색 대상을 맞춘다.
    embedding vector NOT NULL,
    UNIQUE (document_version_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS notifications (
    notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_document_version_id UUID NOT NULL
        REFERENCES document_versions(document_version_id) ON DELETE CASCADE,
    source_device_id UUID REFERENCES devices(device_id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ,
    UNIQUE (source_document_version_id)
);

CREATE INDEX IF NOT EXISTS notifications_user_created_at_idx
    ON notifications (user_id, created_at DESC, notification_id DESC);

CREATE TABLE IF NOT EXISTS notification_items (
    notification_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(notification_id) ON DELETE CASCADE,
    related_document_version_id UUID NOT NULL
        REFERENCES document_versions(document_version_id) ON DELETE CASCADE,
    connection_reason TEXT NOT NULL,
    source_excerpt TEXT,
    related_excerpt TEXT,
    UNIQUE (notification_id, related_document_version_id)
);

CREATE INDEX IF NOT EXISTS notification_items_related_version_idx
    ON notification_items (related_document_version_id);

COMMIT;
