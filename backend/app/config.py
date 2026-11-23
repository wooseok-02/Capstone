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


@lru_cache
def get_settings() -> Settings:
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    names = (
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
    )
    values = {name.lower(): os.getenv(name, "").strip() for name in names}
    missing = [name for name in ("DATABASE_URL", "JWT_SECRET") if not values[name.lower()]]
    if missing:
        raise RuntimeError(f"Missing backend settings: {', '.join(missing)}")
    if len(values["jwt_secret"].encode()) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 bytes")
    return Settings(**values)
