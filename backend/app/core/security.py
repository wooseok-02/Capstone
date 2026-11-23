from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends

from ..config import Settings, get_settings


ISSUER = "knowledge-pet"
ACCESS_AUDIENCE = "knowledge-pet-api"
OAUTH_AUDIENCE = "knowledge-pet-social-oauth"
ACCESS_LIFETIME = 15 * 60
FLOW_LIFETIME = 10 * 60
NO_STORE = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}
SettingsDependency = Annotated[Settings, Depends(get_settings)]


def encode_token(settings: Settings, audience: str, lifetime: int, claims: dict) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {**claims, "iss": ISSUER, "aud": audience, "iat": now, "exp": now + timedelta(seconds=lifetime)},
        settings.jwt_secret,
        algorithm="HS256",
    )


def decode_token(settings: Settings, audience: str, token: str) -> dict:
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=["HS256"],
        issuer=ISSUER,
        audience=audience,
        options={"require": ["iss", "aud", "iat", "exp"]},
    )
