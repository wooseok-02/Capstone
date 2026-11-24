import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret: str
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    naver_redirect_uri: str = ""
    kakao_client_id: str = ""
    kakao_client_secret: str = ""
    kakao_redirect_uri: str = ""
    # Cloudflare R2 (S3 호환). 값이 비어 있으면 문서 업로드·다운로드 API가 503을 반환한다.
    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    r2_region: str = "auto"
    # TODO: URL 유효 시간과 업로드 크기 제한은 팀 확정 전 임시 기본값이다.
    upload_url_expires: int = 1800
    download_url_expires: int = 1800
    ai_download_url_expires: int = 600
    max_upload_bytes: int = 100 * 1024 * 1024
    # AI 서버. 값이 비어 있으면 업로드는 `uploaded`에서 멈추고 검색은 503을 반환한다.
    ai_process_url: str = ""
    ai_embed_url: str = ""
    ai_internal_token: str = ""
    ai_timeout_seconds: int = 300


TEXT_SETTINGS = (
    "DATABASE_URL",
    "JWT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "NAVER_CLIENT_ID",
    "NAVER_CLIENT_SECRET",
    "NAVER_REDIRECT_URI",
    "KAKAO_CLIENT_ID",
    "KAKAO_CLIENT_SECRET",
    "KAKAO_REDIRECT_URI",
    "R2_ENDPOINT_URL",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_REGION",
    "AI_PROCESS_URL",
    "AI_EMBED_URL",
    "AI_INTERNAL_TOKEN",
)
INT_SETTINGS = (
    "UPLOAD_URL_EXPIRES",
    "DOWNLOAD_URL_EXPIRES",
    "AI_DOWNLOAD_URL_EXPIRES",
    "MAX_UPLOAD_BYTES",
    "AI_TIMEOUT_SECONDS",
)


@lru_cache
def get_settings() -> Settings:
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    values = {}
    for name in TEXT_SETTINGS:
        value = os.getenv(name, "").strip()
        if value or name != "R2_REGION":
            values[name.lower()] = value
    for name in INT_SETTINGS:
        value = os.getenv(name, "").strip()
        if value:
            if not value.isdigit() or int(value) <= 0:
                raise RuntimeError(f"{name} must be a positive integer")
            values[name.lower()] = int(value)
    missing = [name for name in ("DATABASE_URL", "JWT_SECRET") if not values[name.lower()]]
    if missing:
        raise RuntimeError(f"Missing backend settings: {', '.join(missing)}")
    if len(values["jwt_secret"].encode()) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 bytes")
    return Settings(**values)
