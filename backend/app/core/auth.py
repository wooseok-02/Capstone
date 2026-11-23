from typing import Annotated

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..database import connect
from .security import ACCESS_AUDIENCE, NO_STORE, SettingsDependency, decode_token


bearer = HTTPBearer(auto_error=False, description="로그인 응답에서 받은 `access_token` 값만 입력하세요.")


def read_database_id(claim: object) -> int:
    if not isinstance(claim, str) or not (1 <= len(claim) <= 19 and claim.isascii() and claim.isdecimal()):
        raise jwt.InvalidTokenError()
    value = int(claim)
    if not 1 <= value <= 2**63 - 1:
        raise jwt.InvalidTokenError()
    return value


def get_current_user_id(
    settings: SettingsDependency,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> int:
    invalid_token = HTTPException(401, "A valid access token is required", headers={
        **NO_STORE, "WWW-Authenticate": "Bearer",
    })
    if credentials is None:
        raise invalid_token
    try:
        claims = decode_token(settings, ACCESS_AUDIENCE, credentials.credentials)
        user_id = read_database_id(claims.get("sub"))
        session_id = read_database_id(claims.get("sid"))
    except jwt.InvalidTokenError:
        raise invalid_token from None

    with connect(settings) as db:
        session = db.execute("""
            SELECT 1 FROM refresh_token
            WHERE id = %s AND user_id = %s
              AND revoked_at IS NULL AND expires_at > clock_timestamp()
            """, (session_id, user_id)).fetchone()
    if session is None:
        raise invalid_token
    return user_id


CurrentUserId = Annotated[int, Depends(get_current_user_id)]
