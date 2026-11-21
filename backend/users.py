from datetime import datetime
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .auth import ACCESS_AUDIENCE, NO_STORE, SettingsDependency, decode_token
from .db import connect


router = APIRouter(tags=["회원 정보"])
bearer = HTTPBearer(auto_error=False, description="로그인 응답에서 받은 `access_token` 값만 입력하세요.")


class UserProfile(BaseModel):
    id: int = Field(description="Knowledge Pet에서 사용하는 회원 번호입니다.")
    provider: str = Field(description="가입에 사용한 소셜 로그인 제공자입니다.")
    nickname: str | None = Field(description="회원의 닉네임입니다. 이름 정보가 없으면 `null`입니다.")
    created_at: datetime = Field(description="회원으로 처음 가입한 시각입니다.")


def read_database_id(claim: object) -> int:
    if not isinstance(claim, str) or not (1 <= len(claim) <= 19 and claim.isascii() and claim.isdecimal()):
        raise jwt.InvalidTokenError()
    value = int(claim)
    if not 1 <= value <= 2**63 - 1:
        raise jwt.InvalidTokenError()
    return value


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
