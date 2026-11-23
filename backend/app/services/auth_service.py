import secrets
from urllib.parse import urlencode

from fastapi import HTTPException
from fastapi.responses import JSONResponse, RedirectResponse

from ..config import Settings
from ..core.security import ACCESS_AUDIENCE, ACCESS_LIFETIME, NO_STORE, encode_token
from ..models.session import LoginSession
from ..schemas.auth import SessionTokenResponse
from .session_service import create_session


def session_response(settings: Settings, session: LoginSession) -> JSONResponse:
    access_token = encode_token(settings, ACCESS_AUDIENCE, ACCESS_LIFETIME, {
        "sub": str(session.user_id), "sid": str(session.id), "jti": secrets.token_urlsafe(16),
    })
    tokens = SessionTokenResponse(
        access_token=access_token, refresh_token=session.refresh_token,
        token_type="bearer", expires_in=ACCESS_LIFETIME,
    )
    return JSONResponse(tokens.model_dump(), headers=NO_STORE)


def login_social_user(db, provider: str, provider_user_id: str, nickname: str | None) -> LoginSession:
    user = db.execute("""
        INSERT INTO users (provider, provider_user_id, nickname)
        VALUES (%s, %s, %s)
        ON CONFLICT (provider, provider_user_id) DO NOTHING
        RETURNING id
        """, (provider, provider_user_id, nickname)).fetchone()
    if user is None:
        # This statement also sees a user inserted by a concurrent login.
        user = db.execute("""
            SELECT id FROM users WHERE provider = %s AND provider_user_id = %s
            FOR KEY SHARE
            """, (provider, provider_user_id)).fetchone()
        if user is None:
            raise HTTPException(409, "로그인 중 계정 상태가 변경됐습니다. 로그인을 다시 시작해 주세요.", headers=NO_STORE)
    return create_session(db, user["id"])


def desktop_redirect(port: int, **params: str) -> RedirectResponse:
    return RedirectResponse(f"http://127.0.0.1:{port}/oauth/callback?{urlencode(params)}", status_code=302, headers=NO_STORE)
