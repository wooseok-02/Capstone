from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials

from ..core.auth import bearer, read_database_id
from ..core.security import ACCESS_AUDIENCE, NO_STORE, SettingsDependency, decode_token
from ..database import connect
from ..schemas.user import UserProfile


router = APIRouter(tags=["회원 정보"])


@router.get(
    "/me", response_model=UserProfile,
    summary="내 회원 정보 조회",
    description="접근 토큰과 로그인 세션을 확인한 뒤 현재 로그인한 회원의 정보를 반환합니다.",
    response_description="회원 번호, 소셜 로그인 제공자, 닉네임과 가입 시각입니다.",
)
def me(
    response: Response, settings: SettingsDependency,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
):
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
        user = db.execute("""
            SELECT users.id, users.provider, users.nickname, users.created_at
            FROM users JOIN refresh_token AS session ON session.user_id = users.id
            WHERE users.id = %s AND session.id = %s
              AND session.revoked_at IS NULL AND session.expires_at > clock_timestamp()
            """, (user_id, session_id)).fetchone()
    if user is None:
        raise invalid_token
    response.headers.update(NO_STORE)
    return user
